/**
 * QuickJsRuntime 宿主层测试
 * 每次 run 都应创建并销毁独立 Worker，失败与并发调用互不污染。
 */
import { describe, it, expect, vi } from 'vitest';
import { QuickJsRuntime, type WorkerFactory } from '../QuickJsRuntime';
import { RANKING_SPEC, type PluginSpec, type PluginRunResult } from '../../../domain/plugin/types';

const binary = new ArrayBuffer(8);

interface FakeWorkerShape {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
  onmessageerror: (() => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
}

function makeFake() {
  return {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  } as FakeWorkerShape;
}

function drivingFactory(workers: FakeWorkerShape[], result: PluginRunResult): WorkerFactory {
  return () => {
    const w = makeFake();
    workers.push(w);
    w.postMessage = vi.fn((msg: { type: string }) => {
      if (msg.type === 'init') queueMicrotask(() => w.onmessage?.({ data: { type: 'ready' } }));
      else if (msg.type === 'run') queueMicrotask(() => w.onmessage?.({ data: { type: 'result', result } }));
    });
    return w as unknown as Worker;
  };
}

const okResult: PluginRunResult = { ok: true, output: [1, 2, 3], logs: [], elapsedMs: 5 };
function spec(overrides?: Partial<PluginSpec>): PluginSpec {
  return { ...RANKING_SPEC, ...overrides, limits: { ...RANKING_SPEC.limits, ...overrides?.limits } };
}

describe('QuickJsRuntime', () => {
  it('完成 init → ready → run → result，并在结果返回后立即销毁 Worker', async () => {
    const workers: FakeWorkerShape[] = [];
    const runtime = new QuickJsRuntime({ workerFactory: drivingFactory(workers, okResult), wasmBinary: binary });
    const result = await runtime.run('function rank(){return [1,2,3]}', [], spec());
    expect(result).toEqual(okResult);
    expect(workers).toHaveLength(1);
    expect(workers[0]!.postMessage).toHaveBeenCalledWith({ type: 'init', wasmBinary: binary });
    expect(workers[0]!.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'run', code: 'function rank(){return [1,2,3]}' }),
    );
    expect(workers[0]!.terminate).toHaveBeenCalledTimes(1);
    await runtime.dispose();
    expect(workers[0]!.terminate).toHaveBeenCalledTimes(1);
  });

  it('连续调用分别创建并销毁 Worker，不复用执行环境', async () => {
    const workers: FakeWorkerShape[] = [];
    const runtime = new QuickJsRuntime({ workerFactory: drivingFactory(workers, okResult), wasmBinary: binary });
    await runtime.run('a', [], spec());
    await runtime.run('b', [], spec());
    await runtime.run('c', [], spec());
    expect(workers).toHaveLength(3);
    for (const worker of workers) expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('硬超时强制 terminate 并返回 timeout 失败', async () => {
    vi.useFakeTimers();
    try {
      let w!: FakeWorkerShape;
      const runtime = new QuickJsRuntime({
        workerFactory: () => { w = makeFake(); return w as unknown as Worker; },
        wasmBinary: binary,
        hardTimeoutMarginMs: 10,
      });
      const promise = runtime.run('while(true){}', [], spec({ limits: { ...RANKING_SPEC.limits, timeoutMs: 50 } }));
      await vi.advanceTimersByTimeAsync(60);
      const result = await promise;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.phase).toBe('timeout');
      expect(w.terminate).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('一次调用超时不影响下一次调用', async () => {
    vi.useFakeTimers();
    try {
      const workers: FakeWorkerShape[] = [];
      let first = true;
      const factory: WorkerFactory = () => {
        const w = makeFake();
        workers.push(w);
        if (first) { first = false; return w as unknown as Worker; }
        w.postMessage = vi.fn((msg: { type: string }) => {
          if (msg.type === 'init') queueMicrotask(() => w.onmessage?.({ data: { type: 'ready' } }));
          else if (msg.type === 'run') queueMicrotask(() => w.onmessage?.({ data: { type: 'result', result: okResult } }));
        });
        return w as unknown as Worker;
      };
      const runtime = new QuickJsRuntime({ workerFactory: factory, wasmBinary: binary, hardTimeoutMarginMs: 10 });
      const s = spec({ limits: { ...RANKING_SPEC.limits, timeoutMs: 50 } });
      const p1 = runtime.run('bad', [], s);
      await vi.advanceTimersByTimeAsync(60);
      expect((await p1).ok).toBe(false);
      expect((await runtime.run('good', [], s)).ok).toBe(true);
      expect(workers).toHaveLength(2);
      for (const worker of workers) expect(worker.terminate).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('Worker error 与 messageerror 均转成 crash 并销毁 Worker', async () => {
    for (const kind of ['error', 'messageerror'] as const) {
      let w!: FakeWorkerShape;
      const runtime = new QuickJsRuntime({
        workerFactory: () => {
          w = makeFake();
          w.postMessage = vi.fn(() => queueMicrotask(() => {
            if (kind === 'error') w.onerror?.({ message: 'WASM trap' });
            else w.onmessageerror?.();
          }));
          return w as unknown as Worker;
        },
        wasmBinary: binary,
      });
      const result = await runtime.run('x', [], spec());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.phase).toBe('crash');
      expect(w.terminate).toHaveBeenCalledTimes(1);
    }
  });

  it('Worker error 消息与 WASM 加载失败均销毁当前 Worker', async () => {
    let w!: FakeWorkerShape;
    const runtime = new QuickJsRuntime({
      workerFactory: () => {
        w = makeFake();
        w.postMessage = vi.fn(() => queueMicrotask(() => w.onmessage?.({
          data: { type: 'error', message: 'warmup failed' },
        })));
        return w as unknown as Worker;
      },
      wasmBinary: binary,
    });
    const result = await runtime.run('x', [], spec());
    expect(result.ok).toBe(false);
    expect(w.terminate).toHaveBeenCalledTimes(1);

    let failedWorker!: FakeWorkerShape;
    const failed = new QuickJsRuntime({
      workerFactory: () => { failedWorker = makeFake(); return failedWorker as unknown as Worker; },
      wasmBinary: async () => { throw new Error('wasm missing'); },
    });
    const failure = await failed.run('x', [], spec());
    expect(failure.ok).toBe(false);
    expect(failedWorker.terminate).toHaveBeenCalledTimes(1);
  });

  it('dispose 会立即终止正在执行的 Worker，之后拒绝新调用', async () => {
    let w!: FakeWorkerShape;
    const runtime = new QuickJsRuntime({
      workerFactory: () => { w = makeFake(); return w as unknown as Worker; },
      wasmBinary: binary,
    });
    const pending = runtime.run('x', [], spec());
    await runtime.dispose();
    expect((await pending).ok).toBe(false);
    expect(w.terminate).toHaveBeenCalledTimes(1);
    await expect(runtime.run('x', [], spec())).rejects.toThrow('已释放');
  });
});
