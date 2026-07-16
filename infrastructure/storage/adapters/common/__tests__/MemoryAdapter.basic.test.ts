import { MemoryAdapter } from '../MemoryAdapter';
import { CacheAdapterType } from '../../../interfaces/ICacheStorage';

describe('MemoryAdapter - Basic Operations', () => {
  let cache: MemoryAdapter;

  beforeEach(async () => {
    cache = new MemoryAdapter({ maxSize: 1024 * 1024 }); // 1MB
    await cache.initialize();
  });

  afterEach(async () => {
    await cache.destroy();
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      const newCache = new MemoryAdapter();
      await expect(newCache.initialize()).resolves.not.toThrow();
    });
  });

  describe('isAvailable', () => {
    it('should always return true', () => {
      expect(cache.isAvailable()).toBe(true);
    });
  });

  describe('get and set', () => {
    it('should set and get cache data', async () => {
      await cache.set('key1', { name: 'Alice' });
      const data = await cache.get<{ name: string }>('key1');

      expect(data).toEqual({ name: 'Alice' });
    });

    it('should return null for non-existent key', async () => {
      const data = await cache.get('non-existent');
      expect(data).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete cache', async () => {
      await cache.set('key1', 'value1');
      await cache.delete('key1');

      const data = await cache.get('key1');
      expect(data).toBeNull();
    });
  });

  describe('has', () => {
    it('should return true for existing cache', async () => {
      await cache.set('key1', 'value1');
      expect(await cache.has('key1')).toBe(true);
    });

    it('should return false for non-existent cache', async () => {
      expect(await cache.has('non-existent')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all cache', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.clear();

      expect(await cache.size()).toBe(0);
    });
  });

  describe('size', () => {
    it('should return cache count', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      expect(await cache.size()).toBe(2);
    });

    it('should return 0 for empty cache', async () => {
      expect(await cache.size()).toBe(0);
    });
  });

  describe('getSize', () => {
    it('should return cache size in bytes', async () => {
      await cache.set('key1', 'value1');
      const size = await cache.getSize();

      expect(size).toBeGreaterThan(0);
    });
  });

  describe('keys', () => {
    it('should return all cache keys', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      const keys = await cache.keys();

      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys.length).toBe(2);
    });

    it('should return empty array for empty cache', async () => {
      const keys = await cache.keys();
      expect(keys.length).toBe(0);
    });
  });

  describe('adapter properties', () => {
    it('should have correct name', () => {
      expect(cache.name).toBe('memory:default');
    });

    it('should have correct type', () => {
      expect(cache.type).toBe(CacheAdapterType.Memory);
    });
  });
});