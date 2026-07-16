import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlatformDetector } from '../core/PlatformDetector';
import type { PlatformType } from '../interfaces';

describe('PlatformDetector', () => {
  const originalProcess = global.process;
  const originalWindow = global.window;

  beforeEach(() => {
    // 清除环境
    vi.stubGlobal('process', undefined);
    vi.stubGlobal('window', undefined);
  });

  afterEach(() => {
    // 恢复环境
    vi.stubGlobal('process', originalProcess);
    vi.stubGlobal('window', originalWindow);
  });

  describe('detect()', () => {
    it('should detect nodejs when process exists', () => {
      vi.stubGlobal('process', { versions: { node: '18.0.0' } });
      
      const platform = PlatformDetector.detect();
      expect(platform).toBe('nodejs');
    });

    it('should detect electron when electron version exists', () => {
      vi.stubGlobal('process', {
        versions: { node: '18.0.0', electron: '28.0.0' }
      });
      
      const platform = PlatformDetector.detect();
      expect(platform).toBe('electron');
    });

    it('should detect react-native when ReactNativeWebView exists', () => {
      vi.stubGlobal('window', {
        ReactNativeWebView: { postMessage: vi.fn() }
      });
      
      const platform = PlatformDetector.detect();
      expect(platform).toBe('react-native');
    });

    it('should detect miniprogram-wechat when wx.miniProgram exists', () => {
      vi.stubGlobal('window', {
        wx: { miniProgram: { postMessage: vi.fn() } }
      });
      
      const platform = PlatformDetector.detect();
      expect(platform).toBe('miniprogram-wechat');
    });

    it('should detect miniprogram-alipay when my.miniProgram exists', () => {
      vi.stubGlobal('window', {
        my: { miniProgram: { postMessage: vi.fn() } }
      });
      
      const platform = PlatformDetector.detect();
      expect(platform).toBe('miniprogram-alipay');
    });

    it('should detect web for regular browser', () => {
      vi.stubGlobal('window', { });
      
      const platform = PlatformDetector.detect();
      expect(platform).toBe('web');
    });
  });

  describe('getCapabilities()', () => {
    it('should return correct capabilities for nodejs', () => {
      const capabilities = PlatformDetector.getCapabilities('nodejs');
      
      expect(capabilities).toEqual({
        webview: false,
        playwright: true,
        nativeFS: true,
        nativeNetwork: true,
        canSpawnProcess: true,
      });
    });

    it('should return correct capabilities for electron', () => {
      const capabilities = PlatformDetector.getCapabilities('electron');
      
      expect(capabilities).toEqual({
        webview: true,
        playwright: true,
        nativeFS: true,
        nativeNetwork: true,
        canSpawnProcess: true,
      });
    });

    it('should return correct capabilities for react-native', () => {
      const capabilities = PlatformDetector.getCapabilities('react-native');
      
      expect(capabilities).toEqual({
        webview: true,
        playwright: false,
        nativeFS: true,
        nativeNetwork: true,
        canSpawnProcess: false,
      });
    });

    it('should return correct capabilities for miniprogram', () => {
      const capabilitiesWechat = PlatformDetector.getCapabilities('miniprogram-wechat');
      const capabilitiesAlipay = PlatformDetector.getCapabilities('miniprogram-alipay');
      
      expect(capabilitiesWechat).toEqual({
        webview: true,
        playwright: false,
        nativeFS: false,
        nativeNetwork: true,
        canSpawnProcess: false,
      });
      
      expect(capabilitiesAlipay).toEqual(capabilitiesWechat);
    });

    it('should return correct capabilities for web', () => {
      const capabilities = PlatformDetector.getCapabilities('web');
      
      expect(capabilities).toEqual({
        webview: false,
        playwright: false,
        nativeFS: false,
        nativeNetwork: false,
        canSpawnProcess: false,
      });
    });
  });
});