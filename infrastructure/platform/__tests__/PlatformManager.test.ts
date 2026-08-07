import { describe, it, expect, beforeEach } from 'vitest';
import { PlatformManager } from '../core/PlatformManager';
import type { IPlatformAdapter, PlatformType, PlatformCapabilities } from '../interfaces';

// Mock adapter
class MockAdapter implements IPlatformAdapter {
  constructor(
    readonly name: PlatformType,
    readonly displayName: string,
    private isCurrent: boolean = false
  ) {}

  isCurrentPlatform(): boolean {
    return this.isCurrent;
  }

  getCapabilities(): PlatformCapabilities {
    return {
      webview: false,
      playwright: false,
      nativeFS: false,
      nativeNetwork: false,
      canSpawnProcess: false,
    };
  }
}

describe('PlatformManager', () => {
  let manager: PlatformManager;

  beforeEach(() => {
    manager = new PlatformManager();
  });

  describe('register()', () => {
    it('should register adapter', () => {
      const adapter = new MockAdapter('nodejs', 'Node.js', false);
      
      manager.register(adapter);
      
      expect(manager.get('nodejs')).toBe(adapter);
    });

    it('should overwrite existing adapter', () => {
      const adapter1 = new MockAdapter('nodejs', 'Node.js', false);
      const adapter2 = new MockAdapter('nodejs', 'Node.js', true);
      
      manager.register(adapter1);
      manager.register(adapter2);
      
      expect(manager.get('nodejs')).toBe(adapter2);
    });
  });

  describe('get()', () => {
    it('should return undefined for unregistered platform', () => {
      expect(manager.get('web')).toBeUndefined();
    });

    it('should return registered adapter', () => {
      const adapter = new MockAdapter('web', 'Web Browser', false);
      manager.register(adapter);
      
      expect(manager.get('web')).toBe(adapter);
    });
  });

  describe('detectCurrent()', () => {
    it('should return undefined when no adapter matches', () => {
      manager.register(new MockAdapter('web', 'Web', false));
      
      expect(manager.detectCurrent()).toBeUndefined();
    });

    it('should return matching adapter', () => {
      const webAdapter = new MockAdapter('web', 'Web', false);
      const nodeAdapter = new MockAdapter('nodejs', 'Node.js', true);
      
      manager.register(webAdapter);
      manager.register(nodeAdapter);
      
      expect(manager.detectCurrent()).toBe(nodeAdapter);
    });

    it('should return first matching adapter', () => {
      const adapter1 = new MockAdapter('web', 'Web 1', true);
      const adapter2 = new MockAdapter('nodejs', 'Node.js', true);
      
      manager.register(adapter1);
      manager.register(adapter2);
      
      expect(manager.detectCurrent()).toBe(adapter1);
    });
  });

  describe('getAll()', () => {
    it('should return empty array when no adapters', () => {
      expect(manager.getAll()).toEqual([]);
    });

    it('should return all registered adapters', () => {
      const webAdapter = new MockAdapter('web', 'Web', false);
      const nodeAdapter = new MockAdapter('nodejs', 'Node.js', false);
      
      manager.register(webAdapter);
      manager.register(nodeAdapter);
      
      expect(manager.getAll()).toEqual([webAdapter, nodeAdapter]);
    });
  });

  describe('getCurrentCapabilities()', () => {
    it('should return undefined when no current adapter', () => {
      manager.register(new MockAdapter('web', 'Web', false));
      
      expect(manager.getCurrentCapabilities()).toBeUndefined();
    });

    it('should return capabilities from current adapter', () => {
      const adapter = new MockAdapter('nodejs', 'Node.js', true);
      manager.register(adapter);
      
      const capabilities = manager.getCurrentCapabilities();
      expect(capabilities).toEqual(adapter.getCapabilities());
    });
  });
});