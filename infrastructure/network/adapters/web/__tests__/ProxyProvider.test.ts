/**
 * ProxyProvider 单元测试（浏览器环境）
 */

import { ProxyProvider } from '../ProxyProvider';
import { Environment, NetworkError } from '../../../interfaces';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

describe('ProxyProvider', () => {
  let provider: ProxyProvider;
  const proxyUrl = 'https://proxy.example.com';

  beforeEach(() => {
    provider = new ProxyProvider({ proxyUrl });
  });

  describe('constructor', () => {
    it('should create provider with correct name', () => {
      expect(provider.name).toBe('ProxyProvider');
    });

    it('should have correct priority', () => {
      expect(provider.priority).toBe(20);
    });

    it('should support correct environments', () => {
      expect(provider.supportedEnvironments).toContain(Environment.WEB);
      expect(provider.supportedEnvironments).toContain(Environment.MOBILE);
    });

    it('should be enabled by default', () => {
      expect(provider['enabled']).toBe(true);
    });

    it('should be disabled when config.enabled is false', () => {
      const disabledProvider = new ProxyProvider({ proxyUrl, enabled: false });
      expect(disabledProvider['enabled']).toBe(false);
    });
  });

  describe('isAvailable', () => {
    it('should return true when proxy is enabled', async () => {
      const result = await provider.isAvailable();
      expect(result).toBe(true);
    });
  });

  describe('healthCheck', () => {
    it('should return true', async () => {
      const result = await provider.healthCheck();
      expect(result).toBe(true);
    });
  });

  describe('request', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should throw error when proxy is disabled', async () => {
      const disabledProvider = new ProxyProvider({ proxyUrl, enabled: false });

      await expect(
        disabledProvider.request({ url: 'https://api.example.com/test' })
      ).rejects.toThrow('Proxy is disabled');
    });

    it('should make request through proxy', async () => {
      const mockResponse = { data: 'test' };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify(mockResponse),
        json: async () => mockResponse,
        headers: new Headers()
      });

      const response = await provider.request({
        url: 'https://api.example.com/test'
      });

      expect(response.status).toBe(200);
      expect(response.data).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(proxyUrl),
        expect.any(Object)
      );
    });
  });
});
