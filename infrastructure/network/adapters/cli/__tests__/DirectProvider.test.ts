/**
 * DirectProvider 单元测试（Node.js 环境）
 */

import { DirectProvider } from '../DirectProvider';
import { Environment } from '../../../interfaces';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

describe('DirectProvider (Node.js)', () => {
  let provider: DirectProvider;

  beforeEach(() => {
    provider = new DirectProvider();
  });

  describe('constructor', () => {
    it('should create provider with correct name', () => {
      expect(provider.name).toBe('DirectProvider');
    });

    it('should have correct priority', () => {
      expect(provider.priority).toBe(30);
    });

    it('should support correct environments', () => {
      expect(provider.supportedEnvironments).toContain(Environment.BACKEND);
      expect(provider.supportedEnvironments).toContain(Environment.DESKTOP);
    });
  });

  describe('isAvailable', () => {
    it('should return true when fetch is available', async () => {
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
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should make HTTP request successfully', async () => {
      const mockData = { id: 1, title: 'test post' };
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockData)),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

      const response = await provider.request({
        url: 'https://jsonplaceholder.typicode.com/posts/1',
        timeout: 5000
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('id');
      expect(response.provider).toBe('DirectProvider');
    }, 10000);

    it('should throw NetworkError when fetch fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch failed'));

      await expect(
        provider.request({
          url: 'https://example.com/api',
          timeout: 5000
        })
      ).rejects.toThrow();
    });

    it('should throw RequestError on non-ok response', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
        text: () => Promise.resolve('Not Found'),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

      await expect(
        provider.request({
          url: 'https://example.com/api',
          timeout: 5000
        })
      ).rejects.toThrow();
    });
  });
});
