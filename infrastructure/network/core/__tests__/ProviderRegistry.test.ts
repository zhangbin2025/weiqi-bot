/**
 * ProviderRegistry 单元测试
 */

import { ProviderRegistry } from '../ProviderRegistry';
import { DirectProvider } from '../../adapters/web/DirectProvider';
import { ProxyProvider } from '../../adapters/web/ProxyProvider';
import { Environment } from '../../interfaces';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  afterEach(() => {
    registry.clear();
  });

  describe('register', () => {
    it('should register provider successfully', () => {
      const provider = new DirectProvider();
      registry.register(provider);

      expect(registry.getProvider(provider.name)).toBe(provider);
    });

    it('should replace existing provider with same name', () => {
      const provider1 = new DirectProvider();
      const provider2 = new DirectProvider();

      registry.register(provider1);
      registry.register(provider2);

      expect(registry.getProvider(provider1.name)).toBe(provider2);
    });
  });

  describe('unregister', () => {
    it('should unregister provider successfully', () => {
      const provider = new DirectProvider();
      registry.register(provider);
      registry.unregister(provider.name);

      expect(registry.getProvider(provider.name)).toBeUndefined();
    });

    it('should not throw error when unregistering non-existent provider', () => {
      expect(() => registry.unregister('non-existent')).not.toThrow();
    });
  });

  describe('getProviders', () => {
    it('should return all registered providers', () => {
      const provider1 = new DirectProvider();
      const provider2 = new ProxyProvider({ proxyUrl: 'https://proxy.example.com' });

      registry.register(provider1);
      registry.register(provider2);

      const providers = registry.getProviders();

      expect(providers.length).toBe(2);
      expect(providers).toContain(provider1);
      expect(providers).toContain(provider2);
    });

    it('should return empty array when no providers registered', () => {
      const providers = registry.getProviders();
      expect(providers.length).toBe(0);
    });
  });

  describe('getProvider', () => {
    it('should return provider by name', () => {
      const provider = new DirectProvider();
      registry.register(provider);

      const result = registry.getProvider(provider.name);

      expect(result).toBe(provider);
    });

    it('should return undefined for non-existent provider', () => {
      const result = registry.getProvider('non-existent');

      expect(result).toBeUndefined();
    });
  });

  describe('selectProvider', () => {
    it('should select provider by environment', async () => {
      const provider = new DirectProvider();
      registry.register(provider);

      const selected = await registry.selectProvider(Environment.WEB);

      expect(selected).toBe(provider);
    });

    it('should return null when no provider available for environment', async () => {
      const selected = await registry.selectProvider(Environment.MINIPROGRAM);

      expect(selected).toBeNull();
    });

    it('should select provider with highest priority', async () => {
      const provider1 = new DirectProvider(); // priority: 10
      const provider2 = new ProxyProvider({ proxyUrl: 'https://proxy.example.com' }); // priority: 20

      registry.register(provider1);
      registry.register(provider2);

      const selected = await registry.selectProvider(Environment.WEB);

      expect(selected).toBe(provider2);
    });
  });

  describe('clear', () => {
    it('should clear all providers', () => {
      const provider = new DirectProvider();
      registry.register(provider);
      registry.clear();

      expect(registry.getProviders().length).toBe(0);
    });
  });
});