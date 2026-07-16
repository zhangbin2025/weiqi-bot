/**
 * ResourceCache 核心功能测试
 */

import { ResourceCache, createResourceCache } from '../cache/ResourceCache';
import { createMockCacheStorage, createMockDocumentStorage } from './mocks';

describe('ResourceCache 核心功能', () => {
  describe('getOrDownload', () => {
    it('应从缓存读取', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'test' });
      
      await mockStorage.set('test:key1', 'cached-data');
      
      const downloader = jest.fn(async () => 'downloaded');
      const result = await cache.getOrDownload('key1', downloader);
      
      expect(downloader).not.toHaveBeenCalled();
      expect(result).toEqual('cached-data');
    });

    it('缓存未命中时应下载并缓存', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'test' });
      
      const downloader = jest.fn(async () => 'downloaded');
      const result = await cache.getOrDownload('key1', downloader, 1000);
      
      expect(downloader).toHaveBeenCalled();
      expect(result).toEqual('downloaded');
      expect(await mockStorage.get('test:key1')).toEqual('downloaded');
    });

    it('禁用缓存时应直接下载', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'test', enabled: false });
      
      const downloader = jest.fn(async () => 'data');
      await cache.getOrDownload('key1', downloader);
      
      expect(downloader).toHaveBeenCalled();
      expect(mockStorage.set).not.toHaveBeenCalled();
    });

    it('应使用 IDocumentStorage 存储', async () => {
      const mockDocStorage = createMockDocumentStorage();
      const cache = new ResourceCache(mockDocStorage, { keyPrefix: 'doc' });
      
      const downloader = jest.fn(async () => 'downloaded');
      const result = await cache.getOrDownload('key1', downloader);
      
      expect(downloader).toHaveBeenCalled();
      expect(result).toEqual('downloaded');
      // IDocumentStorage: use key directly (no prefix)
      expect(await mockDocStorage.findById('key1')).not.toBeNull();
    });
  });

  describe('isCached', () => {
    it('应正确检查 ICacheStorage 缓存状态', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'test' });
      
      expect(await cache.isCached('key1')).toBe(false);
      
      await cache.getOrDownload('key1', jest.fn(async () => 'data'));
      expect(await cache.isCached('key1')).toBe(true);
    });

    it('应正确检查 IDocumentStorage 缓存状态', async () => {
      const mockDocStorage = createMockDocumentStorage();
      const cache = new ResourceCache(mockDocStorage, { keyPrefix: 'doc' });
      
      expect(await cache.isCached('key1')).toBe(false);
      
      await cache.getOrDownload('key1', jest.fn(async () => 'data'));
      expect(await cache.isCached('key1')).toBe(true);
    });
  });

  describe('clear', () => {
    it('应正确清除 ICacheStorage 缓存', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'test' });
      
      await cache.getOrDownload('key1', jest.fn(async () => 'data'));
      expect(await cache.isCached('key1')).toBe(true);
      
      await cache.clear('key1');
      expect(await cache.isCached('key1')).toBe(false);
    });

    it('应正确清除 IDocumentStorage 缓存', async () => {
      const mockDocStorage = createMockDocumentStorage();
      const cache = new ResourceCache(mockDocStorage, { keyPrefix: 'doc' });
      
      await cache.getOrDownload('key1', jest.fn(async () => 'data'));
      expect(await cache.isCached('key1')).toBe(true);
      
      await cache.clear('key1');
      expect(await cache.isCached('key1')).toBe(false);
    });
  });

  describe('工厂函数', () => {
    it('应正确创建缓存实例', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = createResourceCache(mockStorage, 'factory', 1000);
      
      await cache.getOrDownload('key1', jest.fn(async () => 'data'));
      
      expect(await mockStorage.get('factory:key1')).toEqual('data');
    });
  });

  describe('资源大小计算', () => {
    it('应正确计算 Blob 大小', async () => {
      const mockStorage = createMockDocumentStorage();
      const cache = new ResourceCache<Blob>(mockStorage, { keyPrefix: 'blob' });
      
      const blob = new Blob(['test'], { type: 'text/plain' });
      await cache.getOrDownload('key1', jest.fn(async () => blob));
      
      // IDocumentStorage: use key directly (no prefix)
      const doc = await mockStorage.findById('key1');
      expect(doc?.size).toBe(blob.size);
    });

    it('应正确计算字符串大小', async () => {
      const mockStorage = createMockDocumentStorage();
      const cache = new ResourceCache<string>(mockStorage, { keyPrefix: 'str' });
      
      const data = 'hello';
      await cache.getOrDownload('key1', jest.fn(async () => data));
      
      // IDocumentStorage: use key directly (no prefix)
      const doc = await mockStorage.findById('key1');
      expect(doc?.size).toBe(data.length);
    });

    it('应正确计算 JSON 大小', async () => {
      const mockStorage = createMockDocumentStorage();
      const cache = new ResourceCache<{ name: string }>(mockStorage, { keyPrefix: 'json' });
      
      await cache.getOrDownload('key1', jest.fn(async () => ({ name: 'test' })));
      
      // IDocumentStorage: use key directly (no prefix)
      const doc = await mockStorage.findById('key1');
      expect(doc?.size).toBeGreaterThan(0);
    });
  });
});