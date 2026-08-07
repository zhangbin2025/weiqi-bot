/**
 * ResourceCache 缓存行为测试
 */

import { ResourceCache } from '../cache/ResourceCache';
import { createMockCacheStorage } from './mocks';

describe('ResourceCache 缓存行为', () => {
  describe('缓存命中', () => {
    it('缓存命中时不应调用下载器', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'test' });
      
      await mockStorage.set('test:key1', 'cached');
      
      const downloader = jest.fn(async () => 'downloaded');
      const result = await cache.getOrDownload('key1', downloader);
      
      expect(downloader).not.toHaveBeenCalled();
      expect(result).toEqual('cached');
    });

    it('缓存命中时直接返回缓存数据', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'test' });
      
      await mockStorage.set('test:key1', 'cached');
      
      const result = await cache.getOrDownload('key1', jest.fn());
      
      expect(result).toEqual('cached');
    });
  });

  describe('缓存未命中', () => {
    it('缓存未命中时应调用下载器', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'test' });
      
      const downloader = jest.fn(async () => 'downloaded');
      await cache.getOrDownload('key1', downloader);
      
      expect(downloader).toHaveBeenCalled();
    });

    it('缓存未命中时应存储下载的数据', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'test' });
      
      const downloader = jest.fn(async () => 'downloaded');
      await cache.getOrDownload('key1', downloader);
      
      expect(await mockStorage.get('test:key1')).toEqual('downloaded');
    });
  });

  describe('TTL', () => {
    it('应使用指定的 TTL', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'test' });
      
      await cache.getOrDownload('key1', jest.fn(async () => 'data'), 1000);
      
      const meta = await cache.getMetadata('key1');
      expect(meta?.expiresAt).toBeDefined();
    });

    it('应使用默认 TTL', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'test', defaultTTL: 5000 });
      
      await cache.getOrDownload('key1', jest.fn(async () => 'data'));
      
      const meta = await cache.getMetadata('key1');
      expect(meta?.expiresAt).toBeDefined();
    });

    it('TTL 过期后应重新下载', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'test' });
      
      await mockStorage.set('test:key1', 'expired', -1000);
      
      const downloader = jest.fn(async () => 'data');
      const result = await cache.getOrDownload('key1', downloader, 1000);
      
      expect(downloader).toHaveBeenCalled();
      expect(result).toEqual('data');
    });
  });

  describe('clearAll', () => {
    it('应清除指定前缀的所有缓存', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'test' });
      
      const downloader = jest.fn(async () => 'data');
      await cache.getOrDownload('key1', downloader);
      await cache.getOrDownload('key2', downloader);
      
      await cache.clearAll();
      
      expect(await cache.isCached('key1')).toBe(false);
      expect(await cache.isCached('key2')).toBe(false);
    });
  });
});