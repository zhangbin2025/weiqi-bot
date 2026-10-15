/**
 * DefaultNetworkStrategy 跨域直连路由测试
 * @description 验证 Web 环境下已验证站点走 DirectProvider（绕过代理）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultNetworkStrategy } from '../DefaultNetworkStrategy';
import type { INetworkProvider, IUserContext, Environment, UserType } from '../../../interfaces';

describe('DefaultNetworkStrategy 跨域直连', () => {
  let strategy: DefaultNetworkStrategy;
  let direct: INetworkProvider;
  let proxy: INetworkProvider;
  let userContext: IUserContext;

  beforeEach(() => {
    strategy = new DefaultNetworkStrategy();
    direct = {
      name: 'DirectProvider',
      priority: 10,
      supportedEnvironments: ['web'] as Environment[],
      isAvailable: vi.fn().mockResolvedValue(true),
      request: vi.fn(),
      connect: vi.fn(),
    } as unknown as INetworkProvider;
    proxy = {
      name: 'ProxyProvider',
      priority: 20,
      supportedEnvironments: ['web'] as Environment[],
      isAvailable: vi.fn().mockResolvedValue(true),
      request: vi.fn(),
      connect: vi.fn(),
    } as unknown as INetworkProvider;
    userContext = {
      getUserType: vi.fn().mockResolvedValue('free' as UserType),
      hasPaidToken: vi.fn().mockReturnValue(false),
      getAuthToken: vi.fn().mockReturnValue(null),
      hasPermission: vi.fn().mockReturnValue(false),
    } as unknown as IUserContext;
    strategy.setProviders([direct, proxy]);
  });

  const select = (url: string) =>
    strategy.selectProvider('web' as Environment, userContext, { url });

  it('Web + online-go.com → DirectProvider（绕过代理）', async () => {
    const p = await select('https://online-go.com/api/v1/puzzles/?page=1');
    expect(p?.name).toBe('DirectProvider');
  });

  it('Web + 未验证站点 → ProxyProvider（保持原行为）', async () => {
    const p = await select('https://www.101weiqi.com/xxx');
    expect(p?.name).toBe('ProxyProvider');
  });

  it('Web + 伪造域名 evil-online-go.com → ProxyProvider', async () => {
    const p = await select('https://evil-online-go.com/api');
    expect(p?.name).toBe('ProxyProvider');
  });

  it('非 Web 环境不受影响（online-go.com 走原 REST 规则，仍 DirectProvider）', async () => {
    const p = await strategy.selectProvider(
      'backend' as Environment, userContext,
      { url: 'https://online-go.com/api/v1/puzzles/' }
    );
    expect(p?.name).toBe('DirectProvider');
  });

  it('DirectProvider 不可用时回退到 ProxyProvider', async () => {
    (direct.isAvailable as any).mockResolvedValueOnce(false);
    const p = await select('https://online-go.com/api/v1/puzzles/');
    expect(p?.name).toBe('ProxyProvider');
  });

  it('未提供 URL 时不命中直连，走代理兜底', async () => {
    const p = await strategy.selectProvider('web' as Environment, userContext);
    expect(p?.name).toBe('ProxyProvider');
  });

  it('付费用户优先走付费通道，不受直连规则影响', async () => {
    const auth = {
      name: 'AuthenticatedProvider',
      priority: 30,
      supportedEnvironments: ['web'] as Environment[],
      isAvailable: vi.fn().mockResolvedValue(true),
      request: vi.fn(),
      connect: vi.fn(),
    } as unknown as INetworkProvider;
    strategy.setProviders([auth, direct, proxy]);
    (userContext.getUserType as any).mockResolvedValue('paid' as UserType);

    const p = await select('https://online-go.com/api/v1/puzzles/');
    expect(p?.name).toBe('AuthenticatedProvider');
  });
});
