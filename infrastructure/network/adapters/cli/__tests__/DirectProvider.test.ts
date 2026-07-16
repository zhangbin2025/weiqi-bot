/**
 * DirectProvider 单元测试（Node.js 环境）
 */

import { DirectProvider } from '../DirectProvider';
import { Environment } from '../../../interfaces';
import { vi, beforeEach, describe, it, expect } from 'vitest';

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
    it('should make HTTP request successfully', async () => {
      // 在 Node.js 环境中，fetch 是内置的
      const response = await provider.request({
        url: 'https://jsonplaceholder.typicode.com/posts/1',
        timeout: 5000
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('id');
      expect(response.provider).toBe('DirectProvider');
    }, 10000);
  });
});
