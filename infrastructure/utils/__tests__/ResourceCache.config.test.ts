/**
 * ResourceCache 配置测试
 */

import { ResourceCache } from '../cache/ResourceCache';
import { createMockCacheStorage } from './mocks';

describe('ResourceCache 配置', () => {
  describe('enabled 配置', () => {
    it('默认应启用缓存', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'test' });
      
      await cache.getOrDownload('key1', jest.fn(async () => 'data'));
      expect(mockStorage.set).toHaveBeenCalled();
    });

    it('禁用缓存时应直接下载', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'test', enabled: false });
      
      await cache.getOrDownload('key1', jest.fn(async () => 'data'));
      
      expect(mockStorage.set).not.toHaveBeenCalled();
    });

    it('禁用缓存时不应检查缓存', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'test', enabled: false });
      
      await cache.getOrDownload('key1', jest.fn(async () => 'data'));
      expect(mockStorage.get).not.toHaveBeenCalled();
    });
  });

  describe('updateConfig', () => {
    it('应正确更新 enabled', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'test' });
      
      cache.updateConfig({ enabled: false });
      await cache.getOrDownload('key2', jest.fn(async () => 'data'));
      
      expect(mockStorage.set).not.toHaveBeenCalled();
    });

    it('应正确更新 keyPrefix', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'test' });
      
      cache.updateConfig({ keyPrefix: 'new' });
      await cache.getOrDownload('key1', jest.fn(async () => 'data'));
      
      expect(mockStorage.set).toHaveBeenCalledWith('new:key1', 'data', undefined);
    });

    it('应正确更新 defaultTTL', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'test', defaultTTL: 1000 });
      
      cache.updateConfig({ defaultTTL: 5000 });
      await cache.getOrDownload('key1', jest.fn(async () => 'data'));
      
      const meta = await cache.getMetadata('key1');
      expect(meta?.expiresAt).toBeDefined();
    });

    it('部分更新应保留其他配置', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'test', defaultTTL: 1000 });
      
      cache.updateConfig({ enabled: false });
      await cache.getOrDownload('key1', jest.fn(async () => 'data'));
      
      expect(mockStorage.set).not.toHaveBeenCalled();
    });
  });

  describe('keyPrefix', () => {
    it('应正确应用 keyPrefix', async () => {
      const mockStorage = createMockCacheStorage();
      const cache = new ResourceCache(mockStorage, { keyPrefix: 'myprefix' });
      
      await cache.getOrDownload('key1', jest.fn(async () => 'data'));
      expect(mockStorage.set).toHaveBeenCalledWith('myprefix:key1', 'data', undefined);
    });

    it('不同 keyPrefix 应隔离缓存', async () => {
      const mockStorage = createMockCacheStorage();
      const cache1 = new ResourceCache(mockStorage, { keyPrefix: 'cache1' });
      const cache2 = new ResourceCache(mockStorage, { keyPrefix: 'cache2' });
      
      await cache1.getOrDownload('key1', jest.fn(async () => 'data'));
      await cache2.getOrDownload('key1', jest.fn(async () => 'data'));
      
      expect(mockStorage.set).toHaveBeenCalledTimes(2);
      expect(mockStorage.set).toHaveBeenCalledWith('cache1:key1', 'data', undefined);
      expect(mockStorage.set).toHaveBeenCalledWith('cache2:key1', 'data', undefined);
    });
  });
});