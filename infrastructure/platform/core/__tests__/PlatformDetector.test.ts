/**
 * PlatformDetector 外部接口测试
 */

import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { PlatformDetector } from '../PlatformDetector';

describe('PlatformDetector 外部接口', () => {
  const originalProcess = global.process;
  const originalWindow = global.window;

  beforeEach(() => {
    // @ts-expect-error - mock
    global.process = undefined;
    // @ts-expect-error - mock
    global.window = undefined;
  });

  afterEach(() => {
    global.process = originalProcess;
    global.window = originalWindow;
  });

  describe('detect()', () => {
    it('should detect nodejs environment', () => {
      // @ts-expect-error - mock
      global.process = { versions: { node: '18.0.0' } };
      expect(PlatformDetector.detect()).toBe('nodejs');
    });

    it('should detect electron environment', () => {
      // @ts-expect-error - mock
      global.process = { versions: { node: '18.0.0', electron: '28.0.0' } };
      expect(PlatformDetector.detect()).toBe('electron');
    });

    it('should detect react-native environment', () => {
      // @ts-expect-error - mock
      global.window = { ReactNativeWebView: {} };
      expect(PlatformDetector.detect()).toBe('react-native');
    });

    it('should detect web environment', () => {
      // @ts-expect-error - mock
      global.window = {};
      expect(PlatformDetector.detect()).toBe('web');
    });
  });

  describe('getCapabilities()', () => {
    it('should return capabilities for each platform', () => {
      const platforms = ['nodejs', 'electron', 'react-native', 'web', 'miniprogram-wechat', 'miniprogram-alipay'] as const;
      for (const platform of platforms) {
        const caps = PlatformDetector.getCapabilities(platform);
        expect(typeof caps.webview === 'boolean');
        expect(typeof caps.playwright === 'boolean');
        expect(typeof caps.nativeFS === 'boolean');
        expect(typeof caps.nativeNetwork === 'boolean');
        expect(typeof caps.canSpawnProcess === 'boolean');
      }
    });
  });
});