/**
 * NetworkManager 重试集成测试
 * @description 验证 retryCount 被真正执行（历史 bug：字段存在但从未实现重试）
 *
 * 注意：DefaultNetworkStrategy 按名称挑选 provider（ProxyProvider / DirectProvider ...），
 * 故这里把 mock 命名为 ProxyProvider，使其被第 6 条「兜底」规则命中，
 * 从而走到 NetworkManager 的重试分支（而非 requestWithFallback 分支）。
 */

import { NetworkManager } from '../NetworkManager';
import type { INetworkProvider, IUserContext, Environment } from '../../interfaces';
import { NetworkError, RequestError, TimeoutError } from '../../interfaces';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

const OK = {
  status: 200, data: { ok: true }, statusText: 'OK', headers: {},
  config: {}, duration: 1, provider: 'ProxyProvider', timestamp: 0,
};

function makeManager(provider: INetworkProvider, retryCount?: number): NetworkManager {
  const manager = new NetworkManager(retryCount === undefined ? {} : { retryCount });
  const userContext = {
    getUserType: vi.fn().mockResolvedValue('free'),
    hasPaidToken: vi.fn().mockReturnValue(false),
    getAuthToken: vi.fn().mockReturnValue(null),
    hasPermission: vi.fn().mockReturnValue(false),
  } as unknown as IUserContext;
  manager.setUserContext(userContext);
  manager.registerProvider(provider);
  return manager;
}

function makeProvider(impl: () => Promise<unknown>): INetworkProvider {
  return {
    name: 'ProxyProvider',
    priority: 20,
    supportedEnvironments: ['web'] as Environment[],
    isAvailable: vi.fn().mockResolvedValue(true),
    request: vi.fn(impl),
    connect: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
  } as unknown as INetworkProvider;
}

/** 构造 Provider 形态的错误（config 上带 url/method） */
function netErr(url: string, method: string): NetworkError {
  return new NetworkError('Failed to fetch', 'NETWORK_ERROR', 'ProxyProvider', { url, method });
}

describe('NetworkManager 重试行为', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('默认 retryCount=3：瞬时失败后重试并最终成功', async () => {
    let calls = 0;
    const provider = makeProvider(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(netErr('https://online-go.com/api/v1/puzzles/', 'GET'));
      return Promise.resolve(OK);
    });
    const manager = makeManager(provider);

    const p = manager.request({ url: 'https://online-go.com/api/v1/puzzles/' });
    await vi.advanceTimersByTimeAsync(10000);
    const res = await p;

    expect(res).toBe(OK);
    expect(calls).toBe(2);
  });

  it('默认 retryCount=3：连续失败共尝试 4 次（1 次首次 + 3 次重试）', async () => {
    const provider = makeProvider(() => Promise.reject(netErr('https://x.com', 'GET')));
    const manager = makeManager(provider);

    const p = manager.request({ url: 'https://x.com' });
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(30000);

    await expect(p).rejects.toBeInstanceOf(NetworkError);
    expect((provider.request as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(4);
  });

  it('retryCount=0：完全不重试', async () => {
    const provider = makeProvider(() => Promise.reject(netErr('https://x.com', 'GET')));
    const manager = makeManager(provider, 0);

    await expect(manager.request({ url: 'https://x.com' })).rejects.toBeInstanceOf(NetworkError);
    expect((provider.request as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });

  it('4xx 不重试（请求本身有问题）', async () => {
    const provider = makeProvider(() => Promise.reject(
      new RequestError('HTTP 404', 404, 'ProxyProvider', { url: 'https://x.com', method: 'GET' })));
    const manager = makeManager(provider, 3);

    await expect(manager.request({ url: 'https://x.com' })).rejects.toBeInstanceOf(RequestError);
    expect((provider.request as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });

  it('超时可重试', async () => {
    let calls = 0;
    const provider = makeProvider(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new TimeoutError(30000, 'ProxyProvider',
          { url: 'https://x.com', method: 'GET' }));
      }
      return Promise.resolve(OK);
    });
    const manager = makeManager(provider, 3);

    const p = manager.request({ url: 'https://x.com' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(await p).toBe(OK);
    expect(calls).toBe(2);
  });

  it('请求级 retry 覆盖全局 retryCount', async () => {
    const provider = makeProvider(() => Promise.reject(
      new TimeoutError(30000, 'ProxyProvider', { url: 'https://x.com', method: 'GET' })));
    const manager = makeManager(provider, 3);

    const p = manager.request({ url: 'https://x.com', retry: 1 });
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(30000);

    await expect(p).rejects.toBeInstanceOf(TimeoutError);
    // 1 次首次 + 1 次重试（而非全局的 3 次）
    expect((provider.request as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(2);
  });

  it('POST 默认不重试（幂等性保护）', async () => {
    const provider = makeProvider(() => Promise.reject(netErr('https://x.com', 'POST')));
    const manager = makeManager(provider, 3);

    await expect(manager.request({ url: 'https://x.com', method: 'POST' }))
      .rejects.toBeInstanceOf(NetworkError);
    expect((provider.request as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });
});
