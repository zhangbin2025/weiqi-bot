/**
 * PlatformManager 外部接口测试
 */

import { describe, it, beforeEach, expect } from 'vitest';
import { PlatformManager } from '../PlatformManager';
import type { IPlatformAdapter, PlatformType, PlatformCapabilities } from '../../interfaces';

// Mock adapter for testing
class MockAdapter implements IPlatformAdapter {
  readonly displayName: string;
  constructor(
    readonly name: PlatformType,
    private isCurrent: boolean = false
  ) {
    this.displayName = name;
  }
  isCurrentPlatform(): boolean { return this.isCurrent; }
  getCapabilities(): PlatformCapabilities {
    return { webview: false, playwright: false, nativeFS: false, nativeNetwork: false, canSpawnProcess: false };
  }
}

describe('PlatformManager 外部接口', () => {
  let manager: PlatformManager;

  beforeEach(() => { manager = new PlatformManager(); });

  describe('register/get', () => {
    it('should register and retrieve adapter', () => {
      const adapter = new MockAdapter('nodejs');
      manager.register(adapter);
      expect(manager.get('nodejs')).toBe(adapter);
    });

    it('should return undefined for unknown platform', () => {
      expect(manager.get('web')).toBe(undefined);
    });
  });

  describe('detectCurrent', () => {
    it('should return matching adapter', () => {
      const adapter = new MockAdapter('nodejs', true);
      manager.register(adapter);
      expect(manager.detectCurrent()).toBe(adapter);
    });

    it('should return undefined when no match', () => {
      manager.register(new MockAdapter('web', false));
      expect(manager.detectCurrent()).toBe(undefined);
    });
  });

  describe('getAll', () => {
    it('should return all registered adapters', () => {
      const web = new MockAdapter('web');
      const node = new MockAdapter('nodejs');
      manager.register(web);
      manager.register(node);
      expect(manager.getAll()).toEqual([web, node]);
    });
  });

  describe('getCurrentCapabilities', () => {
    it('should return capabilities from current adapter', () => {
      const adapter = new MockAdapter('nodejs', true);
      manager.register(adapter);
      const caps = manager.getCurrentCapabilities();
      expect(caps);
    });

    it('should return undefined when no current adapter', () => {
      manager.register(new MockAdapter('web', false));
      expect(manager.getCurrentCapabilities()).toBe(undefined);
    });
  });
});