/**
 * ConfigManager 外部接口测试
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { ConfigManager } from '../ConfigManager';
import type { IConfigStorage } from '../../interfaces';

// Mock storage for testing
const createMockStorage = (): IConfigStorage => {
  const store = new Map<string, Record<string, unknown>>();
  return {
    load: async (ns: string) => store.get(ns) || {},
    save: async (ns: string, data: Record<string, unknown>) => { store.set(ns, data); },
    delete: async (ns: string) => { store.delete(ns); },
    has: async (ns: string) => store.has(ns),
    export: async () => JSON.stringify(Object.fromEntries(store)),
    import: async (json: string) => {
      const data = JSON.parse(json);
      Object.entries(data).forEach(([k, v]) => store.set(k, v as Record<string, unknown>));
    },
    clear: async () => { store.clear(); },
  };
};

describe('ConfigManager 外部接口', () => {
  let manager: ConfigManager;
  let storage: IConfigStorage;

  beforeEach(() => {
    storage = createMockStorage();
    manager = new ConfigManager(storage);
  });

  afterEach(async () => { await storage.clear(); });

  describe('get/set', () => {
    it('should set and get config value', async () => {
      manager.registerSchema('app', { name: { type: 'string' } });
      await manager.set('app.name', 'test');
      const result = await manager.get<string>('app.name');
      expect(result).toBe('test');
    });

    it('should get default value from schema', async () => {
      manager.registerSchema('app', { debug: { type: 'boolean', default: false } });
      const result = await manager.get<boolean>('app.debug');
      expect(result).toBe(false);
    });

    it('should get module config object', async () => {
      manager.registerSchema('app', { a: { type: 'string' }, b: { type: 'number' } });
      await manager.set('app.a', 'x');
      await manager.set('app.b', 1);
      const config = await manager.get<{ a: string; b: number }>('app');
      expect(config?.a).toBe('x');
      expect(config?.b).toBe(1);
    });
  });

  describe('load/save', () => {
    it('should load stored config', async () => {
      await storage.save('app', { name: 'stored' });
      manager.registerSchema('app', { name: { type: 'string' } });
      const config = await manager.getModuleConfig<{ name: string }>('app');
      expect(config.name).toBe('stored');
    });

    it('should merge default with stored config', async () => {
      await storage.save('app', { name: 'stored' });
      manager.registerSchema('app', { name: { type: 'string' }, debug: { type: 'boolean', default: true } });
      const config = await manager.getModuleConfig<{ name: string; debug: boolean }>('app');
      expect(config.name).toBe('stored');
      expect(config.debug).toBe(true);
    });
  });

  describe('change notification', () => {
    it('should notify on config change', async () => {
      manager.registerSchema('app', { name: { type: 'string' } });
      let called = false;
      manager.onChange('app', () => { called = true; });
      await manager.setModuleConfig('app', { name: 'new' });
      expect(called);
    });

    it('should unsubscribe correctly', async () => {
      manager.registerSchema('app', { name: { type: 'string' } });
      let count = 0;
      const unsub = manager.onChange('app', () => { count++; });
      await manager.setModuleConfig('app', { name: 'a' });
      unsub();
      await manager.setModuleConfig('app', { name: 'b' });
      expect(count).toBe(1);
    });
  });

  describe('has/delete/reset', () => {
    it('should check config existence', async () => {
      manager.registerSchema('app', { name: { type: 'string' } });
      expect(await manager.has('app')).toBe(false);
      await manager.setModuleConfig('app', { name: 'test' });
      expect(await manager.has('app')).toBe(true);
    });

    it('should delete config', async () => {
      manager.registerSchema('app', { name: { type: 'string' } });
      await manager.setModuleConfig('app', { name: 'test' });
      await manager.delete('app');
      expect(await manager.has('app')).toBe(false);
    });

    it('should reset all configs', async () => {
      manager.registerSchema('app', { name: { type: 'string' } });
      await manager.setModuleConfig('app', { name: 'test' });
      await manager.reset();
      expect(await manager.has('app')).toBe(false);
    });
  });
});