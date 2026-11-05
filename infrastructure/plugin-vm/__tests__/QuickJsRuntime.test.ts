/**
 * QuickJsRuntime 宿主层测试
 *
 * 用可控的 FakeWorker 模拟消息往返，验证：
 * - init → ready → run → result 的完整协议
 * - 每轮都创建新 Worker（崩溃可恢复的关键）
 * - 硬超时 terminate + 返回 timeout 失败
 * - Worker error / messageerror / 未初始化 / 重复消息 的容错
 * - dispose 后拒绝执行
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
  const worker: FakeWorkerShape = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
  return worker;
}

/** 模拟一个正常 Worker：init 后回 ready，run 后回 result */
function drivingFactory(workers: FakeWorkerShape[], result: PluginRunResult): WorkerFactory {
  return () => {
    const w = makeFake();
    workers.push(w);
    w.postMessage = vi.fn((msg: { type: string }) => {
      if (msg.type === 'init') {
        queueMicrotask(() => w.onmessage?.({ data: { type: 'ready' } }));
      } else if (msg.type === 'run') {
        queueMicrotask(() => w.onmessage?.({ data: { type: 'result', result } }));
      }
    });
    return w as unknown as Worker;
  };
}

const okResult: PluginRunResult = { ok: true, output: [1, 2, 3], logs: [], elapsedMs: 5 };

function spec(overrides?: Partial<PluginSpec>): PluginSpec {
  return { ...RANKING_SPEC, ...overrides, limits: { ...RANKING_SPEC.limits, ...overrides?.limits } };
}

describe('QuickJsRuntime', () => {
  it('按 init → ready → run → result 协议完成一次执行', async () => {
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
  });

  it('每次 run 都创建全新 Worker（崩溃后可继续）', async () => {
    const workers: FakeWorkerShape[] = [];
    const runtime = new QuickJsRuntime({ workerFactory: drivingFactory(workers, okResult), wasmBinary: binary });
    await runtime.run('a', [], spec());
    await runtime.run('b', [], spec());
    await runtime.run('c', [], spec());
    expect(workers).toHaveLength(3);
    for (const w of workers) expect(w.terminate).toHaveBeenCalledTimes(1);
  });

  it('硬超时强制 terminate 并返回 timeout 失败', async () => {
    vi.useFakeTimers();
    try {
      let w: FakeWorkerShape;
      const factory: WorkerFactory = () => {
        w = makeFake();
        // 故意不回任何消息
        return w as unknown as Worker;
      };
      const runtime = new QuickJsRuntime({
        workerFactory: factory,
        wasmBinary: binary,
        hardTimeoutMarginMs: 10,
      });
      const promise = runtime.run('function rank(){while(true){}}', [], spec({ limits: { ...RANKING_SPEC.limits, timeoutMs: 50 } }));
      await vi.advanceTimersByTimeAsync(60);
      const result = await promise;
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.phase).toBe('timeout');
      expect(w!.terminate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('超时后仍可再次执行（Worker 重建）', async () => {
    vi.useFakeTimers();
    try {
      const workers: FakeWorkerShape[] = [];
      let first = true;
      const factory: WorkerFactory = () => {
        const w = makeFake();
        workers.push(w);
        if (first) {
          first = false;
          // 第一个不响应 → 超时
          return w as unknown as Worker;
        }
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
      const r2 = await runtime.run('good', [], s);
      expect(r2.ok).toBe(true);
      expect(workers).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Worker error 事件转成 crash 失败', async () => {
    let w: FakeWorkerShape;
    const factory: WorkerFactory = () => {
      w = makeFake();
      w.postMessage = vi.fn(() => {
        queueMicrotask(() => w.onerror?.({ message: 'WASM trap' }));
      });
      return w as unknown as Worker;
    };
    const runtime = new QuickJsRuntime({ workerFactory: factory, wasmBinary: binary });
    const result = await runtime.run('x', [], spec());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe('crash');
    expect(result.error?.message).toBe('WASM trap');
    expect(w!.terminate).toHaveBeenCalledTimes(1);
  });

  it('Worker 主动回报 error 消息转成 crash 失败', async () => {
    let w: FakeWorkerShape;
    const factory: WorkerFactory = () => {
      w = makeFake();
      w.postMessage = vi.fn(() => {
        queueMicrotask(() => w.onmessage?.({ data: { type: 'error', message: 'warmup failed' } }));
      });
      return w as unknown as Worker;
    };
    const runtime = new QuickJsRuntime({ workerFactory: factory, wasmBinary: binary });
    const result = await runtime.run('x', [], spec());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe('crash');
    expect(result.error?.message).toBe('warmup failed');
  });

  it('onmessageerror 转成 crash 失败', async () => {
    let w: FakeWorkerShape;
    const factory: WorkerFactory = () => {
      w = makeFake();
      w.postMessage = vi.fn(() => queueMicrotask(() => w.onmessageerror?.()));
      return w as unknown as Worker;
    };
    const runtime = new QuickJsRuntime({ workerFactory: factory, wasmBinary: binary });
    const result = await runtime.run('x', [], spec());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe('crash');
  });

  it('重复结果消息只 resolve 一次且只 terminate 一次', async () => {
    let w: FakeWorkerShape;
    const factory: WorkerFactory = () => {
      w = makeFake();
      w.postMessage = vi.fn((msg: { type: string }) => {
        if (msg.type === 'init') queueMicrotask(() => w.onmessage?.({ data: { type: 'ready' } }));
        else if (msg.type === 'run') {
          queueMicrotask(() => w.onmessage?.({ data: { type: 'result', result: okResult } }));
          queueMicrotask(() => w.onmessage?.({ data: { type: 'result', result: okResult } }));
          queueMicrotask(() => w.onmessage?.({ data: { type: 'result', result: okResult } }));
        }
      });
      return w as unknown as Worker;
    };
    const runtime = new QuickJsRuntime({ workerFactory: factory, wasmBinary: binary });
    const result = await runtime.run('x', [], spec());
    expect(result.ok).toBe(true);
    expect(w!.terminate).toHaveBeenCalledTimes(1);
  });

  it('wasm 提供函数失败时返回 crash 而不是挂起', async () => {
    let w: FakeWorkerShape;
    const factory: WorkerFactory = () => {
      w = makeFake();
      return w as unknown as Worker;
    };
    const runtime = new QuickJsRuntime({
      workerFactory: factory,
      wasmBinary: async () => { throw new Error('wasm missing'); },
    });
    const result = await runtime.run('x', [], spec());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase).toBe('crash');
    expect(result.error?.message).toContain('wasm missing');
    expect(w!.terminate).toHaveBeenCalledTimes(1);
  });

  it('dispose 后拒绝执行', async () => {
    const runtime = new QuickJsRuntime({ workerFactory: drivingFactory([], okResult), wasmBinary: binary });
    await runtime.dispose();
    await expect(runtime.run('x', [], spec())).rejects.toThrow('已释放');
  });
});
