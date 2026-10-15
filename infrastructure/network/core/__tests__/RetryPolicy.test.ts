/**
 * RetryPolicy 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withRetry,
  isRetryableError,
  computeBackoffDelay,
  DEFAULT_RETRY_BASE_DELAY,
  DEFAULT_RETRY_MAX_DELAY,
} from '../RetryPolicy';
import {
  NetworkError,
  TimeoutError,
  NetworkUnreachableError,
  RequestError,
  AuthenticationError,
  PermissionError,
} from '../../interfaces';

/** 构造带 config 的错误，模拟 Provider 抛出的形态 */
function err(e: Error, config?: Record<string, unknown>): Error {
  if (e instanceof NetworkError && config) {
    (e as { config: unknown }).config = config;
  }
  return e;
}

describe('computeBackoffDelay', () => {
  it('指数增长：300 → 600 → 1200', () => {
    expect(computeBackoffDelay(1, 300, 5000, false)).toBe(300);
    expect(computeBackoffDelay(2, 300, 5000, false)).toBe(600);
    expect(computeBackoffDelay(3, 300, 5000, false)).toBe(1200);
  });

  it('不超过 maxDelay', () => {
    expect(computeBackoffDelay(10, 300, 1000, false)).toBe(1000);
  });

  it('抖动落在 [0.5, 1.0) 倍区间内', () => {
    for (let i = 0; i < 50; i++) {
      const d = computeBackoffDelay(3, 300, 5000, true);
      expect(d).toBeGreaterThanOrEqual(600);
      expect(d).toBeLessThanOrEqual(1200);
    }
  });

  it('attempt 为 0 或负数时按首次处理', () => {
    expect(computeBackoffDelay(0, 300, 5000, false)).toBe(300);
    expect(computeBackoffDelay(-5, 300, 5000, false)).toBe(300);
  });
});

describe('isRetryableError', () => {
  it('超时可重试', () => {
    expect(isRetryableError(err(new TimeoutError(30000), { method: 'GET' })).retryable).toBe(true);
  });

  it('网络不可达可重试', () => {
    const e = err(new NetworkUnreachableError('https://x.com'), { method: 'GET' });
    expect(isRetryableError(e).retryable).toBe(true);
  });

  it('代理隧道失败（NetworkError NETWORK_ERROR）可重试', () => {
    const e = err(new NetworkError('Failed to fetch', 'NETWORK_ERROR', 'ProxyProvider'), { method: 'GET' });
    const r = isRetryableError(e);
    expect(r.retryable).toBe(true);
    expect(r.reason).toBe('NETWORK_ERROR');
  });

  it('fetch 原生 TypeError 可重试', () => {
    expect(isRetryableError(new TypeError('Failed to fetch'), 'GET').retryable).toBe(true);
  });

  it('5xx 可重试', () => {
    for (const s of [500, 502, 503, 504]) {
      const e = err(new RequestError(`HTTP ${s}`, s, 'ProxyProvider'), { method: 'GET' });
      expect(isRetryableError(e).retryable).toBe(true);
    }
  });

  it('429 限流可重试', () => {
    const e = err(new RequestError('HTTP 429', 429, 'ProxyProvider'), { method: 'GET' });
    expect(isRetryableError(e).retryable).toBe(true);
  });

  it('4xx（非 408/429）不重试', () => {
    for (const s of [400, 401, 403, 404]) {
      const e = err(new RequestError(`HTTP ${s}`, s, 'ProxyProvider'), { method: 'GET' });
      expect(isRetryableError(e).retryable).toBe(false);
    }
  });

  it('认证失败不重试', () => {
    expect(isRetryableError(new AuthenticationError(), 'GET').retryable).toBe(false);
  });

  it('权限不足不重试', () => {
    expect(isRetryableError(new PermissionError(), 'GET').retryable).toBe(false);
  });

  it('代理被禁用不重试（配置问题）', () => {
    const e = err(new NetworkError('Proxy is disabled', 'PROXY_DISABLED', 'ProxyProvider'), { method: 'GET' });
    expect(isRetryableError(e).retryable).toBe(false);
  });

  it('POST 默认不重试（幂等性保护）', () => {
    const e = err(new NetworkError('Failed to fetch', 'NETWORK_ERROR'), { method: 'POST' });
    const r = isRetryableError(e, 'POST');
    expect(r.retryable).toBe(false);
    expect(r.reason).toContain('非幂等');
  });

  it('POST 在 force=true 时可重试', () => {
    const e = err(new NetworkError('Failed to fetch', 'NETWORK_ERROR'), { method: 'POST' });
    expect(isRetryableError(e, 'POST', true).retryable).toBe(true);
  });

  it('PUT/DELETE 视为幂等可重试', () => {
    for (const m of ['PUT', 'DELETE']) {
      const e = err(new NetworkError('Failed to fetch', 'NETWORK_ERROR'), { method: m });
      expect(isRetryableError(e, m).retryable).toBe(true);
    }
  });

  it('未知错误不重试', () => {
    expect(isRetryableError(new Error('boom'), 'GET').retryable).toBe(false);
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 让 fake timers 下的 sleep 自动推进 */
  const autoSleep = () => {
    return (ms: number) => {
      return new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
        // 立即推进虚拟时钟，避免测试挂起
        vi.advanceTimersByTime(ms);
      });
    };
  };

  it('首次成功则不重试', async () => {
    const op = vi.fn().mockResolvedValue('ok');
    const onRetry = vi.fn();
    const r = await withRetry(op, 2, { onRetry, sleep: autoSleep() });
    expect(r).toBe('ok');
    expect(op.mock.calls.length).toBe(1);
    expect(onRetry.mock.calls.length).toBe(0);
  });

  it('瞬时失败后重试成功', async () => {
    const e = err(new NetworkError('Failed to fetch', 'NETWORK_ERROR'), { method: 'GET', url: 'https://a.b/c' });
    const op = vi.fn()
      .mockRejectedValueOnce(e)
      .mockResolvedValue('ok');
    const onRetry = vi.fn();

    const r = await withRetry(op, 2, { onRetry, sleep: autoSleep() });
    expect(r).toBe('ok');
    expect(op.mock.calls.length).toBe(2);
    expect(onRetry.mock.calls.length).toBe(1);
    expect(onRetry.mock.calls[0][0]).toMatchObject({
      attempt: 1, maxAttempts: 2, url: 'https://a.b/c', method: 'GET', reason: 'NETWORK_ERROR',
    });
  });

  it('连续失败直到用尽次数后抛出最后一个错误', async () => {
    const mk = () => err(new NetworkError('Failed to fetch', 'NETWORK_ERROR'), { method: 'GET' });
    const op = vi.fn().mockRejectedValue(mk());
    const onRetry = vi.fn();

    await expect(withRetry(op, 2, { onRetry, sleep: autoSleep() })).rejects.toBeInstanceOf(NetworkError);
    // 1 次首次 + 2 次重试
    expect(op.mock.calls.length).toBe(3);
    expect(onRetry.mock.calls.length).toBe(2);
  });

  it('maxAttempts=0 时完全不重试', async () => {
    const op = vi.fn().mockRejectedValue(err(new NetworkError('x', 'NETWORK_ERROR'), { method: 'GET' }));
    await expect(withRetry(op, 0, { sleep: autoSleep() })).rejects.toBeInstanceOf(NetworkError);
    expect(op.mock.calls.length).toBe(1);
  });

  it('不可重试的错误立即抛出，不消耗重试次数', async () => {
    const e = err(new RequestError('HTTP 404', 404, 'ProxyProvider'), { method: 'GET' });
    const op = vi.fn().mockRejectedValue(e);
    await expect(withRetry(op, 3, { sleep: autoSleep() })).rejects.toBeInstanceOf(RequestError);
    expect(op.mock.calls.length).toBe(1);
  });

  it('重试次数为负时按 0 处理', async () => {
    const op = vi.fn().mockRejectedValue(err(new NetworkError('x', 'NETWORK_ERROR'), { method: 'GET' }));
    await expect(withRetry(op, -1, { sleep: autoSleep() })).rejects.toBeInstanceOf(NetworkError);
    expect(op.mock.calls.length).toBe(1);
  });

  it('退避时长按指数增长', async () => {
    const e = () => err(new NetworkError('x', 'NETWORK_ERROR'), { method: 'GET' });
    const op = vi.fn().mockRejectedValue(e());
    const delays: number[] = [];
    const onRetry = vi.fn((info: { delayMs: number }) => { delays.push(info.delayMs); });

    await expect(withRetry(op, 3, {
      onRetry, sleep: autoSleep(), baseDelay: DEFAULT_RETRY_BASE_DELAY,
      maxDelay: DEFAULT_RETRY_MAX_DELAY, jitter: false,
    })).rejects.toBeInstanceOf(NetworkError);

    // jitter=false → 精确 300 / 600 / 1200
    expect(delays).toEqual([300, 600, 1200]);
  });

  it('退避不超过 maxDelay', async () => {
    const e = () => err(new NetworkError('x', 'NETWORK_ERROR'), { method: 'GET' });
    const op = vi.fn().mockRejectedValue(e());
    const delays: number[] = [];
    const onRetry = vi.fn((info: { delayMs: number }) => { delays.push(info.delayMs); });

    await expect(withRetry(op, 4, {
      onRetry, sleep: autoSleep(), baseDelay: 300, maxDelay: 500, jitter: false,
    })).rejects.toBeInstanceOf(NetworkError);

    expect(delays).toEqual([300, 500, 500, 500]);
  });
});
