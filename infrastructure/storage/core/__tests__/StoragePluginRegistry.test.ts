/**
 * @vitest-environment jsdom
 */
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { StoragePluginRegistry, StoragePluginLoader } from '../StoragePluginRegistry';
import { LocalStorageAdapter } from '../../adapters/web/LocalStorageAdapter';
import { StorageAdapterType } from '../../interfaces/IKeyValueStorage';

describe('StoragePluginRegistry', () => {
  let registry: StoragePluginRegistry;
  let adapter: LocalStorageAdapter;

  beforeEach(async () => {
    registry = new StoragePluginRegistry();
    adapter = new LocalStorageAdapter('test-app');
    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.destroy();
    registry.clear();
  });

  describe('register', () => {
    it('should register adapter successfully', () => {
      registry.register(adapter);

      expect(registry.has(adapter.name)).toBe(true);
    });

    it('should throw error when registering duplicate adapter', () => {
      registry.register(adapter);

      expect(() => registry.register(adapter)).toThrow(
        `Adapter "${adapter.name}" already registered`
      );
    });
  });

  describe('unregister', () => {
    it('should unregister adapter successfully', () => {
      registry.register(adapter);
      registry.unregister(adapter.name);

      expect(registry.has(adapter.name)).toBe(false);
    });

    it('should not throw error when unregistering non-existent adapter', () => {
      expect(() => registry.unregister('non-existent')).not.toThrow();
    });
  });

  describe('get', () => {
    it('should get registered adapter', () => {
      registry.register(adapter);

      const result = registry.get(adapter.name);

      expect(result).toBe(adapter);
    });

    it('should return undefined for non-existent adapter', () => {
      const result = registry.get('non-existent');

      expect(result).toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return true for registered adapter', () => {
      registry.register(adapter);

      expect(registry.has(adapter.name)).toBe(true);
    });

    it('should return false for non-existent adapter', () => {
      expect(registry.has('non-existent')).toBe(false);
    });
  });

  describe('listAll', () => {
    it('should list all registered adapters', async () => {
      const adapter1 = new LocalStorageAdapter('app1');
      const adapter2 = new LocalStorageAdapter('app2');
      await adapter1.initialize();
      await adapter2.initialize();

      registry.register(adapter1);
      registry.register(adapter2);

      const adapters = registry.listAll();

      expect(adapters.length).toBe(2);
      expect(adapters).toContain(adapter1);
      expect(adapters).toContain(adapter2);

      await adapter1.destroy();
      await adapter2.destroy();
    });

    it('should return empty array when no adapters registered', () => {
      const adapters = registry.listAll();

      expect(adapters.length).toBe(0);
    });
  });

  describe('findByType', () => {
    it('should find adapters by type', async () => {
      const adapter1 = new LocalStorageAdapter('app1');
      const adapter2 = new LocalStorageAdapter('app2');
      await adapter1.initialize();
      await adapter2.initialize();

      registry.register(adapter1);
      registry.register(adapter2);

      const adapters = registry.findByType(StorageAdapterType.LocalStorage);

      expect(adapters.length).toBe(2);

      await adapter1.destroy();
      await adapter2.destroy();
    });

    it('should return empty array when no matching adapters', () => {
      registry.register(adapter);

      const adapters = registry.findByType(StorageAdapterType.IndexedDB);

      expect(adapters.length).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all adapters', () => {
      registry.register(adapter);
      registry.clear();

      expect(registry.listAll().length).toBe(0);
    });
  });
});

describe('StoragePluginLoader', () => {
  let loader: StoragePluginLoader;

  beforeEach(() => {
    loader = new StoragePluginLoader();
  });

  describe('load', () => {
    it('should throw error for invalid plugin path', async () => {
      await expect(
        loader.load({
          name: 'invalid-plugin',
          version: '1.0.0',
          path: './non-existent-plugin',
        })
      ).rejects.toThrow('Failed to load plugin "invalid-plugin"');
    });
  });

  describe('isAvailable', () => {
    it('should return false for non-existent plugin path', async () => {
      const result = await loader.isAvailable('./non-existent-plugin');

      expect(result).toBe(false);
    });
  });
});
