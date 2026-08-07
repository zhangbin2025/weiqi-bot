/**
 * NetworkManager 单元测试
 */

import { NetworkManager } from '../NetworkManager';
import type { INetworkProvider, IUserContext, Environment } from '../interfaces';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

describe('NetworkManager', () => {
  let manager: NetworkManager;
  let mockUserContext: IUserContext;
  let mockProvider: INetworkProvider;

  beforeEach(() => {
    // Mock user context
    mockUserContext = {
      getUserType: vi.fn().mockResolvedValue('free'),
      hasPaidToken: vi.fn().mockReturnValue(false),
      getAuthToken: vi.fn().mockReturnValue('token'),
      hasPermission: vi.fn().mockReturnValue(true)
    };

    // Mock provider with all required methods
    mockProvider = {
      name: 'TestProvider',
      priority: 10,
      supportedEnvironments: ['web'] as Environment[],
      isAvailable: vi.fn().mockResolvedValue(true),
      request: vi.fn().mockResolvedValue({
        status: 200,
        data: { test: 'data' },
        statusText: 'OK',
        headers: {},
        config: {},
        duration: 100,
        provider: 'TestProvider',
        timestamp: Date.now()
      }),
      connect: vi.fn().mockResolvedValue({
        send: vi.fn(),
        close: vi.fn(),
        onMessage: vi.fn(),
        readyState: 1,
        url: 'wss://example.com'
      }),
      createP2PConnection: vi.fn().mockResolvedValue({
        send: vi.fn(),
        close: vi.fn(),
        onData: vi.fn()
      }),
      healthCheck: vi.fn().mockResolvedValue(true)
    } as any;

    manager = new NetworkManager({ userContext: mockUserContext });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create manager with config', () => {
      expect(manager).toBeDefined();
    });

    it('should detect environment on construction', () => {
      const env = manager.getEnvironment();
      expect(env).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await expect(manager.initialize()).resolves.not.toThrow();
    });

    it('should detect environment', async () => {
      await manager.initialize();
      const env = manager.getEnvironment();
      expect(env).toBeDefined();
    });
  });

  describe('setUserContext', () => {
    it('should set user context', () => {
      const newContext = {
        getUserType: vi.fn(),
        hasPaidToken: vi.fn(),
        getAuthToken: vi.fn(),
        hasPermission: vi.fn()
      };

      manager.setUserContext(newContext);
      expect(manager).toBeDefined();
    });
  });

  describe('getEnvironment', () => {
    it('should return current environment', () => {
      const env = manager.getEnvironment();
      expect(env).toBeDefined();
    });
  });

  describe('registerProvider', () => {
    it('should register provider', () => {
      manager.registerProvider(mockProvider);
      expect(manager).toBeDefined();
    });
  });

  describe('unregisterProvider', () => {
    it('should unregister provider', () => {
      manager.registerProvider(mockProvider);
      manager.unregisterProvider('TestProvider');
      expect(manager).toBeDefined();
    });
  });

  describe('request', () => {
    it('should throw error when user context not set', async () => {
      const managerWithoutContext = new NetworkManager();

      await expect(
        managerWithoutContext.request({ url: '/api/test' })
      ).rejects.toThrow('User context not set');
    });

    it('should make request with registered provider', async () => {
      // 设置 userContext
      manager.setUserContext(mockUserContext);
      
      // Mock provider 支持 BACKEND 环境（Node.js 测试环境）
      mockProvider.supportedEnvironments = ['backend'] as Environment[];
      manager.registerProvider(mockProvider);
      await manager.initialize();

      const response = await manager.request({ url: '/api/test' });

      expect(response).toBeDefined();
      expect(response.status).toBe(200);
    });
  });

  describe('connect', () => {
    it('should throw error when no provider available', async () => {
      await manager.initialize();

      await expect(
        manager.connect('wss://example.com')
      ).rejects.toThrow('No available provider');
    });
  });

  describe('createP2PConnection', () => {
    it('should throw error when provider does not support P2P', async () => {
      const providerWithoutP2P = {
        ...mockProvider,
        createP2PConnection: undefined
      };

      manager.registerProvider(providerWithoutP2P as any);
      await manager.initialize();

      await expect(
        manager.createP2PConnection({
          signalingUrl: 'wss://signal.example.com',
          roomId: 'room-123'
        })
      ).rejects.toThrow('No available provider for WebRTC connection');
    });
  });
});