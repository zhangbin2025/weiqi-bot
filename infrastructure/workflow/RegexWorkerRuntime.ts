/**
 * One-shot Worker runner for host regex operators.
 *
 * A synchronous RegExp cannot be interrupted by a timer on its own event loop.
 * This runner therefore terminates the dedicated Worker at the deadline; it
 * never falls back to executing regex on the UI/main thread.
 */
export type RegexWorkerFactory = () => Worker;

export interface RegexWorkerRunnerOptions {
  workerFactory?: RegexWorkerFactory;
  timeoutMs?: number;
}

interface RegexWorkerReply {
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

const defaultWorkerFactory: RegexWorkerFactory = () => new Worker(
  new URL('./regex.worker.ts', import.meta.url),
  { type: 'module' },
);

export function createRegexWorkerRunner(options: RegexWorkerRunnerOptions = {}):
  (method: string, args: Record<string, unknown>) => Promise<unknown> {
  const workerFactory = options.workerFactory ?? defaultWorkerFactory;
  const timeoutMs = options.timeoutMs ?? 1000;

  return (method, args) => new Promise<unknown>((resolve, reject) => {
    let worker: Worker | null = null;
    let settled = false;
    const id = 1;
    const cleanup = (): void => {
      clearTimeout(timer);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        try { worker.terminate(); } catch { /* already stopped */ }
        worker = null;
      }
    };
    const finish = (error: Error | null, value?: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      finish(new Error(`regex 执行超过 ${timeoutMs}ms，Worker 已强制终止`));
    }, timeoutMs);

    try {
      worker = workerFactory();
    } catch (error) {
      clearTimeout(timer);
      settled = true;
      reject(new Error(`无法创建 regex Worker：${String(error)}`));
      return;
    }

    worker.onmessage = (event: MessageEvent<RegexWorkerReply>) => {
      const reply = event.data;
      if (!reply || reply.id !== id) return;
      if (reply.ok) finish(null, reply.value);
      else finish(new Error(reply.error || 'regex 执行失败'));
    };
    worker.onerror = (event: ErrorEvent) => {
      finish(new Error(event.message || 'regex Worker 运行异常'));
    };
    worker.onmessageerror = () => finish(new Error('regex Worker 消息无法结构化克隆'));
    try {
      worker.postMessage({ id, method, args });
    } catch (error) {
      finish(new Error(`无法向 regex Worker 发送请求：${String(error)}`));
    }
  });
}
