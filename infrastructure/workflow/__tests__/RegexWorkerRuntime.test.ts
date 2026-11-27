import { describe, expect, it, vi } from 'vitest';
import { createRegexWorkerRunner } from '../RegexWorkerRuntime';

type FakeWorker = {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: (() => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
};

function fakeWorker(): FakeWorker {
  return {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
}

describe('RegexWorkerRuntime', () => {
  it('returns worker results and terminates the one-shot worker', async () => {
    const worker = fakeWorker();
    worker.postMessage.mockImplementation((message: { id: number }) => {
      queueMicrotask(() => worker.onmessage?.({
        data: { id: message.id, ok: true, value: ['42'] },
      } as MessageEvent));
    });
    const run = createRegexWorkerRunner({
      workerFactory: () => worker as unknown as Worker,
      timeoutMs: 100,
    });

    await expect(run('extract', { text: '42', pattern: '\\d+' })).resolves.toEqual(['42']);
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('hard-terminates a worker that never responds', async () => {
    const worker = fakeWorker();
    const run = createRegexWorkerRunner({
      workerFactory: () => worker as unknown as Worker,
      timeoutMs: 5,
    });

    await expect(run('match', { text: 'a', pattern: 'a' })).rejects.toThrow('强制终止');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('surfaces worker-side validation errors and still terminates', async () => {
    const worker = fakeWorker();
    worker.postMessage.mockImplementation((message: { id: number }) => {
      queueMicrotask(() => worker.onmessage?.({
        data: { id: message.id, ok: false, error: 'invalid pattern' },
      } as MessageEvent));
    });
    const run = createRegexWorkerRunner({ workerFactory: () => worker as unknown as Worker });
    await expect(run('match', {})).rejects.toThrow('invalid pattern');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
