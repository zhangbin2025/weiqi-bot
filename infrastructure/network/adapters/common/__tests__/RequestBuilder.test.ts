/**
 * RequestBuilder 单元测试
 */

import { RequestBuilder } from '../RequestBuilder';

describe('RequestBuilder', () => {
  let builder: RequestBuilder;

  beforeEach(() => {
    builder = new RequestBuilder();
  });

  describe('url', () => {
    it('should set URL', () => {
      const config = builder.url('/api/games').build();
      expect(config.url).toBe('/api/games');
    });
  });

  describe('method', () => {
    it('should set method', () => {
      const config = builder.url('/api/games').method('POST').build();
      expect(config.method).toBe('POST');
    });
  });

  describe('header', () => {
    it('should set single header', () => {
      const config = builder
        .url('/api/games')
        .header('Authorization', 'Bearer token')
        .build();
      expect(config.headers).toEqual({ Authorization: 'Bearer token' });
    });
  });

  describe('headers', () => {
    it('should set multiple headers', () => {
      const config = builder
        .url('/api/games')
        .headers({ 'Content-Type': 'application/json', Accept: 'application/json' })
        .build();
      expect(config.headers).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json'
      });
    });
  });

  describe('param', () => {
    it('should set single param', () => {
      const config = builder.url('/api/games').param('limit', 10).build();
      expect(config.params).toEqual({ limit: 10 });
    });
  });

  describe('params', () => {
    it('should set multiple params', () => {
      const config = builder
        .url('/api/games')
        .params({ limit: 10, offset: 0 })
        .build();
      expect(config.params).toEqual({ limit: 10, offset: 0 });
    });
  });

  describe('data', () => {
    it('should set request body', () => {
      const body = { name: 'test' };
      const config = builder.url('/api/games').data(body).build();
      expect(config.data).toEqual(body);
    });
  });

  describe('timeout', () => {
    it('should set timeout', () => {
      const config = builder.url('/api/games').timeout(5000).build();
      expect(config.timeout).toBe(5000);
    });
  });

  describe('retry', () => {
    it('should set retry count', () => {
      const config = builder.url('/api/games').retry(3).build();
      expect(config.retry).toBe(3);
    });
  });

  describe('requireAuth', () => {
    it('should set requireAuth', () => {
      const config = builder.url('/api/games').requireAuth(true).build();
      expect(config.requireAuth).toBe(true);
    });
  });

  describe('responseType', () => {
    it('should set response type', () => {
      const config = builder.url('/api/games').responseType('blob').build();
      expect(config.responseType).toBe('blob');
    });
  });

  describe('build', () => {
    it('should throw error when URL is not set', () => {
      expect(() => builder.build()).toThrow('URL is required');
    });

    it('should build complete config', () => {
      const config = builder
        .url('/api/games')
        .method('GET')
        .header('Authorization', 'Bearer token')
        .param('limit', 10)
        .timeout(5000)
        .build();

      expect(config.url).toBe('/api/games');
      expect(config.method).toBe('GET');
      expect(config.headers).toEqual({ Authorization: 'Bearer token' });
      expect(config.params).toEqual({ limit: 10 });
      expect(config.timeout).toBe(5000);
    });
  });

  describe('reset', () => {
    it('should reset builder', () => {
      builder.url('/api/games').method('POST');
      builder.reset();

      expect(() => builder.build()).toThrow('URL is required');
    });
  });

  describe('static methods', () => {
    it('should create GET request with static get', () => {
      const config = RequestBuilder.get('/api/games').build();
      expect(config.url).toBe('/api/games');
      expect(config.method).toBe('GET');
    });

    it('should create POST request with static post', () => {
      const body = { name: 'test' };
      const config = RequestBuilder.post('/api/games', body).build();
      expect(config.url).toBe('/api/games');
      expect(config.method).toBe('POST');
      expect(config.data).toEqual(body);
    });

    it('should create PUT request with static put', () => {
      const body = { name: 'test' };
      const config = RequestBuilder.put('/api/games', body).build();
      expect(config.url).toBe('/api/games');
      expect(config.method).toBe('PUT');
      expect(config.data).toEqual(body);
    });

    it('should create DELETE request with static delete', () => {
      const config = RequestBuilder.delete('/api/games').build();
      expect(config.url).toBe('/api/games');
      expect(config.method).toBe('DELETE');
    });

    it('should create builder from existing config', () => {
      const existingConfig = {
        url: '/api/games',
        method: 'POST' as const,
        data: { name: 'test' }
      };
      const config = RequestBuilder.from(existingConfig).build();
      expect(config.url).toBe('/api/games');
      expect(config.method).toBe('POST');
      expect(config.data).toEqual({ name: 'test' });
    });
  });
});
