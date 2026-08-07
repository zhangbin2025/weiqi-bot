import { MemoryAdapter } from '../MemoryAdapter';

describe('MemoryAdapter - TTL and Metadata', () => {
  let cache: MemoryAdapter;

  beforeEach(async () => {
    cache = new MemoryAdapter({ maxSize: 1024 * 1024 }); // 1MB
    await cache.initialize();
  });

  afterEach(async () => {
    await cache.destroy();
  });

  describe('TTL behavior', () => {
    it('should return null for expired cache', async () => {
      await cache.set('key1', { name: 'Alice' }, 100); // 100ms TTL

      // 等待过期
      await new Promise((resolve) => setTimeout(resolve, 150));

      const data = await cache.get('key1');
      expect(data).toBeNull();
    });

    it('should return false for expired cache in has()', async () => {
      await cache.set('key1', 'value1', 100); // 100ms TTL

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(await cache.has('key1')).toBe(false);
    });

    it('should auto-expire on get', async () => {
      await cache.set('key1', 'value1', 100); // 100ms TTL

      await new Promise((resolve) => setTimeout(resolve, 150));

      const data = await cache.get('key1');
      expect(data).toBeNull();
      expect(await cache.has('key1')).toBe(false);
    });
  });

  describe('isExpired', () => {
    it('should return false for non-expired cache', async () => {
      await cache.set('key1', 'value1', 10000);
      expect(await cache.isExpired('key1')).toBe(false);
    });

    it('should return true for expired cache', async () => {
      await cache.set('key1', 'value1', 100); // 100ms TTL

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(await cache.isExpired('key1')).toBe(true);
    });

    it('should return false for never-expire cache', async () => {
      await cache.set('key1', 'value1'); // no TTL
      expect(await cache.isExpired('key1')).toBe(false);
    });

    it('should return true for non-existent cache', async () => {
      expect(await cache.isExpired('non-existent')).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should cleanup expired cache', async () => {
      await cache.set('key1', 'value1', 100); // 100ms TTL
      await cache.set('key2', 'value2', 10000); // 10s TTL

      await new Promise((resolve) => setTimeout(resolve, 150));

      const cleaned = await cache.cleanup();

      expect(cleaned).toBe(1);
      expect(await cache.has('key1')).toBe(false);
      expect(await cache.has('key2')).toBe(true);
    });
  });

  describe('getMetadata', () => {
    it('should return cache metadata', async () => {
      await cache.set('key1', { name: 'Alice' }, 10000);

      const meta = await cache.getMetadata<{ name: string }>('key1');

      expect(meta).not.toBeNull();
      expect(meta?.data).toEqual({ name: 'Alice' });
      expect(meta?.createdAt).toBeGreaterThan(0);
      expect(meta?.expiresAt).toBeGreaterThan(0);
      expect(meta?.lastAccessedAt).toBeGreaterThan(0);
    });

    it('should return null for non-existent cache', async () => {
      const meta = await cache.getMetadata('non-existent');
      expect(meta).toBeNull();
    });
  });
});