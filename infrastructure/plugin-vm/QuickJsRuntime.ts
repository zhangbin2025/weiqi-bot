/**
 * 插件沙箱运行时（宿主侧）
 *
 * 每次算子调用都创建独立 Worker：init/WASM 加载、执行、返回结果后立即
 * terminate。Worker、QuickJS 模块、Runtime、Context 均不跨调用复用。
 * 这样一次调用的死循环、WASM trap、内存破坏或插件残留状态不会污染下一次调用。
 */

import type { IPluginRuntime, PluginSpec, PluginRunResult } from '../../domain/plugin/types';

export type WorkerFactory = () => Worker;

export interface QuickJsRuntimeOptions {
  workerFactory: WorkerFactory;
  wasmBinary: ArrayBuffer | (() => Promise<ArrayBuffer>);
  /** Worker 硬超时余量：QuickJS 自身 timeout 之外的缓冲 */
  hardTimeoutMarginMs?: number;
}

interface WorkerReply { type: 'result'; result: PluginRunResult }
interface WorkerReady { type: 'ready' }
interface WorkerError { type: 'error'; message: string }
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
  private readonly activeCalls = new Set<() => void>();

  constructor(private readonly options: QuickJsRuntimeOptions) {}

  run(code: string, input: unknown, spec: PluginSpec): Promise<PluginRunResult> {
    if (this.disposed) return Promise.reject(new Error('QuickJsRuntime 已释放'));
    return this.runIsolated(code, input, spec);
  }

  private runIsolated(code: string, input: unknown, spec: PluginSpec): Promise<PluginRunResult> {
    const started = Date.now();
    const hardTimeoutMs = spec.limits.timeoutMs + (this.options.hardTimeoutMarginMs ?? 1000);

    return new Promise<PluginRunResult>((resolve) => {
      let worker: Worker | null = null;
      let settled = false;
      let ready = false;
      let timer: ReturnType<typeof setTimeout>;

      const cleanup = (): void => {
        clearTimeout(timer);
        if (worker) {
          worker.onmessage = null;
          worker.onerror = null;
          worker.onmessageerror = null;
          try { worker.terminate(); } catch { /* Worker 已退出 */ }
          worker = null;
        }
        this.activeCalls.delete(cancel);
      };

      const finish = (result: PluginRunResult): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      const cancel = (): void => {
        finish(makeFailure('crash', 'QuickJsRuntime 已释放', started));
      };

      this.activeCalls.add(cancel);
      timer = setTimeout(() => {
        finish(makeFailure('timeout', `超过 ${hardTimeoutMs}ms 硬超时`, started));
      }, hardTimeoutMs);

      if (this.disposed) {
        cancel();
        return;
      }

      try {
        worker = this.options.workerFactory();
      } catch (error) {
        finish(makeFailure('crash', `无法创建沙箱 Worker: ${String(error)}`, started));
        return;
      }

      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        if (settled) return;
        const msg = event.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'ready') {
          if (ready) return;
          ready = true;
          try {
            worker?.postMessage({ type: 'run', code, input, spec });
          } catch (error) {
            finish(makeFailure('crash', `无法向沙箱发送执行请求: ${String(error)}`, started));
          }
          return;
        }
        if (msg.type === 'error') {
          finish(makeFailure('crash', msg.message || 'Worker 初始化或执行失败', started));
          return;
        }
        if (msg.type === 'result') finish(msg.result);
      };
      worker.onerror = (event: ErrorEvent) => {
        finish(makeFailure('crash', event.message || 'Worker 运行异常', started));
      };
      worker.onmessageerror = () => {
        finish(makeFailure('crash', 'Worker 消息无法结构化克隆', started));
      };

      void (async () => {
        try {
          const provider = this.options.wasmBinary;
          const binary = typeof provider === 'function' ? await provider() : provider;
          if (settled || this.disposed) return;
          worker?.postMessage({ type: 'init', wasmBinary: binary });
        } catch (error) {
          finish(makeFailure('crash', `wasm 资源读取失败: ${String(error)}`, started));
        }
      })();
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const cancel of [...this.activeCalls]) cancel();
  }
}
