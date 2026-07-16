/**
 * @vitest-environment jsdom
 */
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { LocalStorageAdapter } from '../LocalStorageAdapter';
import { StorageAdapterType } from '../../../interfaces/IKeyValueStorage';

describe('LocalStorageAdapter', () => {
  let adapter: LocalStorageAdapter;

  beforeEach(async () => {
    // 清空 localStorage
    localStorage.clear();
    adapter = new LocalStorageAdapter('test-app');
    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.destroy();
  });

  describe('initialize', () => {
    it('should initialize successfully when localStorage is available', async () => {
      const newAdapter = new LocalStorageAdapter('new-app');
      await expect(newAdapter.initialize()).resolves.not.toThrow();
    });

    it('should throw error when localStorage is not available', async () => {
      // 模拟 localStorage 不可用
      const originalLocalStorage = global.localStorage;
      // @ts-ignore
      delete global.localStorage;

      const newAdapter = new LocalStorageAdapter('error-app');
      await expect(newAdapter.initialize()).rejects.toThrow(
        'localStorage is not available'
      );

      global.localStorage = originalLocalStorage;
    });
  });

  describe('isAvailable', () => {
    it('should return true when localStorage is available', () => {
      expect(adapter.isAvailable()).toBe(true);
    });
  });

  describe('read and write', () => {
    it('should write and read object data', async () => {
      const data = { theme: 'dark', fontSize: 14 };
      await adapter.write('config', data);

      const result = await adapter.read<{ theme: string; fontSize: number }>(
        'config'
      );

      expect(result).toEqual(data);
    });

    it('should write and read string data', async () => {
      await adapter.write('name', 'test-value');

      const result = await adapter.read<string>('name');

      expect(result).toBe('test-value');
    });

    it('should return null for non-existent key', async () => {
      const result = await adapter.read('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete existing data', async () => {
      await adapter.write('key', 'value');
      await adapter.delete('key');

      const result = await adapter.read('key');

      expect(result).toBeNull();
    });
  });

  describe('exists', () => {
    it('should return true for existing key', async () => {
      await adapter.write('key', 'value');

      const result = await adapter.exists('key');

      expect(result).toBe(true);
    });

    it('should return false for non-existent key', async () => {
      const result = await adapter.exists('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('listKeys', () => {
    it('should list all keys without pattern', async () => {
      await adapter.write('key1', 'value1');
      await adapter.write('key2', 'value2');

      const keys = await adapter.listKeys();

      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys.length).toBe(2);
    });

    it('should list keys matching pattern', async () => {
      await adapter.write('user-1', 'value1');
      await adapter.write('user-2', 'value2');
      await adapter.write('admin-1', 'value3');

      const keys = await adapter.listKeys('user-*');

      expect(keys).toContain('user-1');
      expect(keys).toContain('user-2');
      expect(keys.length).toBe(2);
    });
  });

  describe('clear', () => {
    it('should clear all data', async () => {
      await adapter.write('key1', 'value1');
      await adapter.write('key2', 'value2');
      await adapter.clear();

      const keys = await adapter.listKeys();

      expect(keys.length).toBe(0);
    });
  });

  describe('namespace isolation', () => {
    it('should isolate data by namespace', async () => {
      const adapter1 = new LocalStorageAdapter('app1');
      const adapter2 = new LocalStorageAdapter('app2');

      await adapter1.initialize();
      await adapter2.initialize();

      await adapter1.write('key', 'value1');
      await adapter2.write('key', 'value2');

      const result1 = await adapter1.read<string>('key');
      const result2 = await adapter2.read<string>('key');

      expect(result1).toBe('value1');
      expect(result2).toBe('value2');

      await adapter1.destroy();
      await adapter2.destroy();
    });
  });

  describe('adapter properties', () => {
    it('should have correct name', () => {
      expect(adapter.name).toBe('localStorage:test-app');
    });

    it('should have correct type', () => {
      expect(adapter.type).toBe(StorageAdapterType.LocalStorage);
    });
  });
});
