/**
 * 插件沙箱运行时（宿主侧）
 * @module infrastructure/plugin-vm/QuickJsRuntime
 *
 * 每次 run() 都创建一个全新的 Worker，执行完（或超时/崩溃）立即 terminate。
 * 原因（实测）：QuickJS 的协作式中断拦不住 native 栈溢出，深度递归会把整个
 * WASM 实例打崩；只有「一次执行 = 一个可丢弃的 Worker」才能把崩溃变成
 * 可回收的失败信号，从而让 LLM 的「看报错 → 改代码 → 重跑」闭环转起来。
 */

import type { IPluginRuntime, PluginSpec, PluginRunResult } from '../../domain/plugin/types';

/** Worker 构造函数可注入，便于测试与不同构建环境 */
export type WorkerFactory = () => Worker;

export interface QuickJsRuntimeOptions {
  workerFactory: WorkerFactory;
  /** wasm 二进制；Worker 启动后作为 init 消息传入 */
  wasmBinary: ArrayBuffer | (() => Promise<ArrayBuffer>);
  /** 硬超时余量：Worker 侧 timeout 之外的额外缓冲 */
  hardTimeoutMarginMs?: number;
}

interface WorkerReply {
  type: 'result';
  result: PluginRunResult;
}

interface WorkerReady {
  type: 'ready';
}

interface WorkerError {
  type: 'error';
  message: string;
}

type WorkerMessage = WorkerReply | WorkerReady | WorkerError;

function makeFailure(
  phase: 'crash' | 'timeout',
  message: string,
  started: number,
): PluginRunResult {
  return {
    ok: false,
    phase,
    error: { name: phase === 'timeout' ? 'HardTimeoutError' : 'WorkerCrashError', message },
    hint: phase === 'timeout'
      ? '插件未能在限定时间内结束，已强制终止，请简化逻辑'
      : '沙箱进程异常终止，请修改代码后重试',
    logs: [],
    elapsedMs: Date.now() - started,
  };
}

export class QuickJsRuntime implements IPluginRuntime {
  private disposed = false;

  constructor(private readonly options: QuickJsRuntimeOptions) {}

  async run(code: string, input: unknown, spec: PluginSpec): Promise<PluginRunResult> {
    if (this.disposed) throw new Error('QuickJsRuntime 已释放');
    const started = Date.now();
    const margin = this.options.hardTimeoutMarginMs ?? 1000;
    const hardTimeoutMs = spec.limits.timeoutMs + margin;

    let worker: Worker;
    try {
      worker = this.options.workerFactory();
    } catch (error) {
      return makeFailure('crash', `无法创建沙箱 Worker: ${String(error)}`, started);
    }

    return new Promise<PluginRunResult>((resolve) => {
      let settled = false;
      const finish = (result: PluginRunResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { worker.terminate(); } catch { /* 已终止 */ }
        resolve(result);
      };

      const timer = setTimeout(
        () => finish(makeFailure('timeout', `超过 ${hardTimeoutMs}ms 硬超时`, started)),
        hardTimeoutMs,
      );

      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const msg = event.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'result') finish(msg.result);
        else if (msg.type === 'error') finish(makeFailure('crash', msg.message, started));
        else if (msg.type === 'ready') {
          worker.postMessage({ type: 'run', code, input, spec });
        }
      };
      worker.onerror = (event: ErrorEvent) => {
        finish(makeFailure('crash', event.message || 'Worker 运行异常', started));
      };
      worker.onmessageerror = () => {
        finish(makeFailure('crash', 'Worker 消息无法结构化克隆', started));
      };

      // 启动：把 wasm 二进制交给 Worker，避免它自己解析路径
      void (async () => {
        try {
          const provider = this.options.wasmBinary;
          const binary = typeof provider === 'function' ? await provider() : provider;
          worker.postMessage({ type: 'init', wasmBinary: binary });
        } catch (error) {
          finish(makeFailure('crash', `wasm 资源读取失败: ${String(error)}`, started));
        }
      })();
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}
