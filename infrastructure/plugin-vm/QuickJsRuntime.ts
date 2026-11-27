/**
 * 插件沙箱运行时（宿主侧）
 * @module infrastructure/plugin-vm/QuickJsRuntime
 *
 * Worker 按需启动并复用；每次 run 仍在 QuickJsExecutor 中创建独立 QuickJS
 * Runtime + Context。调用串行排队，避免同一 Worker 并发污染消息/执行状态。
 * 遇到硬超时、Worker 崩溃、OOM 或无法恢复的沙箱故障时立即销毁 Worker；
 * 下一次调用重新创建，保留原有故障隔离边界。
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

interface WorkerReply { type: 'result'; result: PluginRunResult }
interface WorkerReady { type: 'ready' }
interface WorkerError { type: 'error'; message: string }
type WorkerMessage = WorkerReply | WorkerReady | WorkerError;

interface ActiveRun {
  started: number;
  resolve: (result: PluginRunResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface WorkerSession {
  worker: Worker;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: Error) => void;
  readySettled: boolean;
  active?: ActiveRun;
}

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
  private session: WorkerSession | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: QuickJsRuntimeOptions) {}

  run(code: string, input: unknown, spec: PluginSpec): Promise<PluginRunResult> {
    if (this.disposed) return Promise.reject(new Error('QuickJsRuntime 已释放'));
    const task = this.queue.then(() => this.runOne(code, input, spec));
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  private createSession(started: number): WorkerSession | null {
    let worker: Worker;
    try {
      worker = this.options.workerFactory();
    } catch {
      return null;
    }

    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    // ready 失败会由 runOne 消费；附加处理器避免初始化与销毁竞态产生未处理拒绝。
    void ready.catch(() => undefined);
    const session: WorkerSession = {
      worker, ready, resolveReady, rejectReady, readySettled: false,
    };
    this.session = session;

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'ready') {
        if (!session.readySettled) {
          session.readySettled = true;
          session.resolveReady();
        }
        return;
      }
      if (msg.type === 'error') {
        this.breakSession(session, makeFailure('crash', msg.message, session.active?.started ?? started));
        return;
      }
      if (msg.type === 'result') {
        const active = session.active;
        if (!active) return;
        clearTimeout(active.timer);
        delete session.active;
        // crash / timeout / oom 可能意味着 QuickJS/WASM 状态已不可信，必须回收 Worker。
        if (!msg.result.ok && (
          msg.result.phase === 'crash' || msg.result.phase === 'timeout' || msg.result.phase === 'oom'
        )) {
          this.terminateSession(session);
        }
        active.resolve(msg.result);
      }
    };
    worker.onerror = (event: ErrorEvent) => {
      this.breakSession(session, makeFailure(
        'crash', event.message || 'Worker 运行异常', session.active?.started ?? started,
      ));
    };
    worker.onmessageerror = () => {
      this.breakSession(session, makeFailure(
        'crash', 'Worker 消息无法结构化克隆', session.active?.started ?? started,
      ));
    };

    void (async () => {
      try {
        const provider = this.options.wasmBinary;
        const binary = typeof provider === 'function' ? await provider() : provider;
        if (this.session === session && !this.disposed) {
          worker.postMessage({ type: 'init', wasmBinary: binary });
        }
      } catch (error) {
        this.breakSession(session, makeFailure(
          'crash', `wasm 资源读取失败: ${String(error)}`, session.active?.started ?? started,
        ));
      }
    })();
    return session;
  }

  private async runOne(code: string, input: unknown, spec: PluginSpec): Promise<PluginRunResult> {
    if (this.disposed) throw new Error('QuickJsRuntime 已释放');
    const started = Date.now();
    const margin = this.options.hardTimeoutMarginMs ?? 1000;
    const hardTimeoutMs = spec.limits.timeoutMs + margin;
    const session = this.session ?? this.createSession(started);
    if (!session) return makeFailure('crash', '无法创建沙箱 Worker', started);

    return new Promise<PluginRunResult>((resolve) => {
      const active: ActiveRun = {
        started,
        resolve,
        timer: setTimeout(() => {
          this.breakSession(
            session,
            makeFailure('timeout', `超过 ${hardTimeoutMs}ms 硬超时`, started),
          );
        }, hardTimeoutMs),
      };
      session.active = active;

      void session.ready.then(() => {
        if (this.session !== session || session.active !== active || this.disposed) return;
        try {
          session.worker.postMessage({ type: 'run', code, input, spec });
        } catch (error) {
          this.breakSession(
            session,
            makeFailure('crash', `无法向沙箱发送执行请求: ${String(error)}`, started),
          );
        }
      }).catch((error: unknown) => {
        if (session.active === active) {
          this.breakSession(
            session,
            makeFailure('crash', error instanceof Error ? error.message : String(error), started),
          );
        }
      });
    });
  }

  private breakSession(session: WorkerSession, failure: PluginRunResult): void {
    if (this.session === session) this.session = null;
    try { session.worker.terminate(); } catch { /* 已终止 */ }
    if (!session.readySettled) {
      session.readySettled = true;
      session.rejectReady(new Error(failure.error?.message ?? '沙箱 Worker 已终止'));
    }
    const active = session.active;
    if (active) {
      clearTimeout(active.timer);
      delete session.active;
      active.resolve(failure);
    }
  }

  private terminateSession(session: WorkerSession): void {
    if (this.session === session) this.session = null;
    try { session.worker.terminate(); } catch { /* 已终止 */ }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const session = this.session;
    if (session) {
      this.breakSession(session, makeFailure('crash', 'QuickJsRuntime 已释放', Date.now()));
    }
    await this.queue;
  }
}
