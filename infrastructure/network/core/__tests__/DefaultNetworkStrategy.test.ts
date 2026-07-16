/**
 * DefaultNetworkStrategy 单元测试
 */

import { DefaultNetworkStrategy } from '../DefaultNetworkStrategy';
import type { INetworkProvider, IUserContext, Environment, UserType } from '../../../interfaces';

describe('DefaultNetworkStrategy', () => {
  let strategy: DefaultNetworkStrategy;
  let mockProviders: jest.Mocked<INetworkProvider>[];
  let mockUserContext: jest.Mocked<IUserContext>;

  beforeEach(() => {
    strategy = new DefaultNetworkStrategy();

    // 创建 mock providers（使用 AuthenticatedProvider 名称）
    mockProviders = [
      {
        name: 'AuthenticatedProvider',
        priority: 30,
        supportedEnvironments: ['web', 'desktop'] as Environment[],
        isAvailable: jest.fn().mockResolvedValue(true),
        request: jest.fn(),
        connect: jest.fn()
      } as any,
      {
        name: 'ProxyProvider',
        priority: 20,
        supportedEnvironments: ['web'] as Environment[],
        isAvailable: jest.fn().mockResolvedValue(true),
        request: jest.fn(),
        connect: jest.fn()
      } as any,
      {
        name: 'DirectProvider',
        priority: 10,
        supportedEnvironments: ['web', 'desktop', 'backend'] as Environment[],
        isAvailable: jest.fn().mockResolvedValue(true),
        request: jest.fn(),
        connect: jest.fn()
      } as any
    ];

    // 创建 mock user context
    mockUserContext = {
      getUserType: jest.fn(),
      hasPaidToken: jest.fn(),
      getAuthToken: jest.fn(),
      hasPermission: jest.fn()
    };

    strategy.setProviders(mockProviders);
  });

  describe('setProviders', () => {
    it('should set providers list', () => {
      const providers: INetworkProvider[] = [];
      strategy.setProviders(providers);
      expect(strategy.getProviderPriority('web' as Environment, 'free' as UserType)).toEqual([]);
    });
  });

  describe('selectProvider', () => {
    it('should select provider for free user', async () => {
      mockUserContext.getUserType.mockResolvedValue('free' as UserType);

      const provider = await strategy.selectProvider(
        'web' as Environment,
        mockUserContext
      );

      expect(provider).toBeDefined();
      // Free user gets highest priority available provider (not AuthenticatedProvider)
      expect(provider?.name).toBe('ProxyProvider');
    });

    it('should select AuthenticatedProvider for paid user', async () => {
      mockUserContext.getUserType.mockResolvedValue('paid' as UserType);

      const provider = await strategy.selectProvider(
        'web' as Environment,
        mockUserContext
      );

      expect(provider).toBeDefined();
      expect(provider?.name).toBe('AuthenticatedProvider');
    });

    it('should return UnsupportedProvider when no provider available', async () => {
      mockProviders.forEach(p => p.isAvailable.mockResolvedValue(false));
      mockUserContext.getUserType.mockResolvedValue('free' as UserType);

      const provider = await strategy.selectProvider(
        'web' as Environment,
        mockUserContext
      );

      // Returns UnsupportedProvider for friendly error messages
      expect(provider).toBeDefined();
      expect(provider?.name).toBe('UnsupportedProvider');
    });

    it('should skip unavailable providers', async () => {
      mockProviders[0].isAvailable.mockResolvedValue(false);
      mockUserContext.getUserType.mockResolvedValue('free' as UserType);

      const provider = await strategy.selectProvider(
        'web' as Environment,
        mockUserContext
      );

      expect(provider?.name).toBe('ProxyProvider');
    });
  });

  describe('getProviderPriority', () => {
    it('should return providers sorted by priority', () => {
      const providers = strategy.getProviderPriority(
        'web' as Environment,
        'free' as UserType
      );

      expect(providers[0].priority).toBeGreaterThanOrEqual(providers[1].priority);
    });

    it('should filter providers by environment', () => {
      const providers = strategy.getProviderPriority(
        'backend' as Environment,
        'free' as UserType
      );

      expect(providers.length).toBe(1);
      expect(providers[0].name).toBe('DirectProvider');
    });

    it('should prioritize AuthenticatedProvider for paid user', () => {
      const providers = strategy.getProviderPriority(
        'web' as Environment,
        'paid' as UserType
      );

      expect(providers[0].name).toBe('AuthenticatedProvider');
    });

    it('should return empty array when no providers match', () => {
      const providers = strategy.getProviderPriority(
        'miniprogram' as Environment,
        'free' as UserType
      );

      expect(providers).toEqual([]);
    });
  });
});
