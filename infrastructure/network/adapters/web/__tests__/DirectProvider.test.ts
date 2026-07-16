/**
 * DirectProvider 单元测试（浏览器环境）
 */

import { DirectProvider } from '../DirectProvider';
import { Environment, NetworkError, TimeoutError, RequestError } from '../../../interfaces';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

describe('DirectProvider', () => {
  let provider: DirectProvider;

  beforeEach(() => {
    provider = new DirectProvider();
  });

  describe('constructor', () => {
    it('should create provider with correct name', () => {
      expect(provider.name).toBe('DirectProvider');
    });

    it('should have correct priority', () => {
      expect(provider.priority).toBe(10);
    });

    it('should support correct environments', () => {
      expect(provider.supportedEnvironments).toContain(Environment.WEB);
      expect(provider.supportedEnvironments).toContain(Environment.DESKTOP);
      expect(provider.supportedEnvironments).toContain(Environment.MOBILE);
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
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should make GET request successfully', async () => {
      const mockResponse = { data: 'test' };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify(mockResponse),
        json: async () => mockResponse,
        headers: new Headers()
      });

      const response = await provider.request({ url: 'https://api.example.com/test' });

      expect(response.status).toBe(200);
      expect(response.data).toEqual(mockResponse);
      expect(response.provider).toBe('DirectProvider');
    });

    it('should make POST request with body', async () => {
      const mockResponse = { success: true };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 201,
        statusText: 'Created',
        text: async () => JSON.stringify(mockResponse),
        json: async () => mockResponse,
        headers: new Headers()
      });

      const response = await provider.request({
        url: 'https://api.example.com/test',
        method: 'POST',
        data: { name: 'test' }
      });

      expect(response.status).toBe(201);
      expect(response.data).toEqual(mockResponse);
    });

    it('should throw RequestError on HTTP error', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not Found',
      });

      await expect(
        provider.request({ url: 'https://api.example.com/not-found' })
      ).rejects.toThrow(RequestError);
    });

    it('should throw TimeoutError on timeout', async () => {
      (global.fetch as any).mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 10000))
      );

      await expect(
        provider.request({ url: 'https://api.example.com/test', timeout: 100 })
      ).rejects.toThrow(TimeoutError);
    });
  });
});
