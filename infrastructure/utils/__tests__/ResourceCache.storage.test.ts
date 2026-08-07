/**
 * ResourceCache 存储兼容性测试
 */

import { ResourceCache } from '../cache/ResourceCache';
import { createMockCacheStorage, createMockDocumentStorage } from './mocks';

describe('ResourceCache 存储兼容性', () => {
  describe('ICacheStorage', () => {
    let mockStorage: jest.Mocked<ReturnType<typeof createMockCacheStorage>>;
    let cache: ResourceCache<string>;

    beforeEach(() => {
      mockStorage = createMockCacheStorage();
      cache = new ResourceCache(mockStorage, { keyPrefix: 'test' });
    });

    it('应正确使用 get', async () => {
      await cache.getOrDownload('key1', jest.fn(async () => 'data'));
      expect(mockStorage.get).toHaveBeenCalledWith('test:key1');
    });

    it('应正确使用 set', async () => {
      await cache.getOrDownload('key1', jest.fn(async () => 'data'), 1000);
      expect(mockStorage.set).toHaveBeenCalledWith('test:key1', 'data', 1000);
    });

    it('应正确使用 has', async () => {
      await cache.isCached('key1');
      expect(mockStorage.has).toHaveBeenCalledWith('test:key1');
    });

    it('应正确使用 delete', async () => {
      await cache.getOrDownload('key1', jest.fn(async () => 'data'));
      await cache.clear('key1');
      expect(mockStorage.delete).toHaveBeenCalledWith('test:key1');
    });

    it('应支持 getMetadata', async () => {
      await cache.getOrDownload('key1', jest.fn(async () => 'data'), 1000);
      const meta = await cache.getMetadata('key1');
      
      expect(meta).not.toBeNull();
      expect(meta?.createdAt).toBeDefined();
      expect(meta?.expiresAt).toBeDefined();
    });
  });

  describe('IDocumentStorage', () => {
    let mockStorage: jest.Mocked<ReturnType<typeof createMockDocumentStorage>>;
    let cache: ResourceCache<string>;

    beforeEach(() => {
      mockStorage = createMockDocumentStorage();
      cache = new ResourceCache(mockStorage, { keyPrefix: 'doc' });
    });

    it('应正确使用 findById', async () => {
      await cache.getOrDownload('key1', jest.fn(async () => 'data'));
      // IDocumentStorage: use key directly (no prefix)
      expect(mockStorage.findById).toHaveBeenCalledWith('key1');
    });

    it('应正确使用 insert', async () => {
      await cache.getOrDownload('key1', jest.fn(async () => 'data'));
      expect(mockStorage.insert).toHaveBeenCalled();
    });

    it('应正确使用 exists', async () => {
      await cache.isCached('key1');
      // IDocumentStorage: use key directly (no prefix)
      expect(mockStorage.exists).toHaveBeenCalledWith('key1');
    });

    it('应正确使用 delete', async () => {
      await cache.getOrDownload('key1', jest.fn(async () => 'data'));
      await cache.clear('key1');
      // IDocumentStorage: use key directly (no prefix)
      expect(mockStorage.delete).toHaveBeenCalledWith('key1');
    });

    it('不支持 getMetadata', async () => {
      await cache.getOrDownload('key1', jest.fn(async () => 'data'));
      const meta = await cache.getMetadata('key1');
      expect(meta).toBeNull();
    });
  });
});