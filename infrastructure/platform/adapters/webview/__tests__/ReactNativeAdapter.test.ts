import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReactNativeAdapter } from '../ReactNativeAdapter';

describe('ReactNativeAdapter', () => {
  let adapter: ReactNativeAdapter;

  beforeEach(() => {
    adapter = new ReactNativeAdapter();
    vi.stubGlobal('window', undefined);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(adapter.name).toBe('react-native');
    });

    it('should have correct displayName', () => {
      expect(adapter.displayName).toBe('React Native');
    });
  });

  describe('isCurrentPlatform()', () => {
    it('should return false in Node.js environment', () => {
      // 在 Node.js 环境中测试
      expect(adapter.isCurrentPlatform()).toBe(false);
    });
  });

  describe('getCapabilities()', () => {
    it('should return correct capabilities', () => {
      const capabilities = adapter.getCapabilities();
      
      expect(capabilities).toEqual({
        webview: true,
        playwright: false,
        nativeFS: true,
        nativeNetwork: true,
        canSpawnProcess: false,
      });
    });
  });

  describe('supportsWebSocketHook()', () => {
    it('should return true', () => {
      expect(adapter.supportsWebSocketHook()).toBe(true);
    });
  });

  describe('supportsHttpHook()', () => {
    it('should return true', () => {
      expect(adapter.supportsHttpHook()).toBe(true);
    });
  });

  describe('loadUrl()', () => {
    it('should create session with correct URL', async () => {
      const session = await adapter.loadUrl('https://example.com');
      
      expect(session.url).toBe('https://example.com');
    });

    it('should create session with unique ID', async () => {
      const session1 = await adapter.loadUrl('https://example1.com');
      const session2 = await adapter.loadUrl('https://example2.com');
      
      expect(session1.sessionId).not.toBe(session2.sessionId);
      expect(session1.sessionId).toMatch(/^webview-/);
    });
  });
});

describe('ReactNativeWebViewSession', () => {
  let adapter: ReactNativeAdapter;
  let session: any;

  beforeEach(async () => {
    adapter = new ReactNativeAdapter();
    session = await adapter.loadUrl('https://example.com', {
      hookWebSocket: true,
      hookHttp: true,
    });
  });

  describe('getInjectedScript()', () => {
    it('should include WebSocket hook when hookWebSocket is true', () => {
      const script = session.getInjectedScript();
      
      expect(script).toContain('__WS_HOOKED__');
    });

    it('should include HTTP hook when hookHttp is true', () => {
      const script = session.getInjectedScript();
      
      expect(script).toContain('__HTTP_HOOKED__');
    });

    it('should include injectedScripts when provided', async () => {
      const customSession = await adapter.loadUrl('https://example.com', {
        injectedScripts: ['console.log("custom")'],
      });
      
      const script = customSession.getInjectedScript();
      expect(script).toContain('console.log("custom")');
    });

    it('should return empty string when no hooks', async () => {
      const emptySession = await adapter.loadUrl('https://example.com');
      
      const script = emptySession.getInjectedScript();
      expect(script).toBe('');
    });
  });

  describe('onWebSocketMessage()', () => {
    it('should register callback and return unsubscribe function', () => {
      const callback = vi.fn();
      const unsub = session.onWebSocketMessage(callback);
      
      expect(typeof unsub).toBe('function');
    });
  });

  describe('handleNativeMessage()', () => {
    it('should call ws callbacks for ws_message', () => {
      const callback = vi.fn();
      session.onWebSocketMessage(callback);
      
      session.handleNativeMessage(JSON.stringify({
        type: 'ws_message',
        data: { url: 'ws://example.com', direction: 'receive', data: 'test' }
      }));
      
      expect(callback).toHaveBeenCalled();
    });

    it('should call ws callbacks for ws_send', () => {
      const callback = vi.fn();
      session.onWebSocketMessage(callback);
      
      session.handleNativeMessage(JSON.stringify({
        type: 'ws_send',
        data: { url: 'ws://example.com', direction: 'send', data: 'test' }
      }));
      
      expect(callback).toHaveBeenCalled();
    });

    it('should ignore invalid JSON', () => {
      const callback = vi.fn();
      session.onWebSocketMessage(callback);
      
      session.handleNativeMessage('invalid json');
      
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('close()', () => {
    it('should clear callbacks', async () => {
      const callback = vi.fn();
      session.onWebSocketMessage(callback);
      
      await session.close();
      
      session.handleNativeMessage(JSON.stringify({
        type: 'ws_message',
        data: {}
      }));
      
      expect(callback).not.toHaveBeenCalled();
    });
  });
});