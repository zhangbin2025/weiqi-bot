/**
 * SignalingClient 单元测试
 */

import { SignalingClient } from '../SignalingClient';
import type { ISignalingMessage } from '../SignalingClient';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

// WebSocket 常量
const WS_CONNECTING = 0;
const WS_OPEN = 1;

describe('SignalingClient', () => {
  let client: SignalingClient;
  let mockWebSocket: any;

  beforeEach(() => {
    // 创建 WebSocket mock
    mockWebSocket = {
      readyState: WS_CONNECTING,
      send: vi.fn(),
      close: vi.fn(),
      onopen: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onclose: null as (() => void) | null,
      onmessage: null as ((event: any) => void) | null
    };

    global.WebSocket = vi.fn().mockImplementation(() => {
      // 返回 mock 对象，不自动触发 onopen
      return mockWebSocket;
    }) as any;
    (WebSocket as any).CONNECTING = WS_CONNECTING;
    (WebSocket as any).OPEN = WS_OPEN;
  });

  afterEach(() => {
    client?.disconnect();
  });

  describe('constructor', () => {
    it('should create client with config', () => {
      client = new SignalingClient({
        url: 'wss://signal.example.com',
        roomId: 'room-123',
        userId: 'user-456'
      });
      expect(client).toBeDefined();
    });
  });

  describe('connect', () => {
    it('should connect to signaling server', async () => {
      client = new SignalingClient({ url: 'wss://signal.example.com' });
      
      const connectPromise = client.connect();
      
      // 手动触发 onopen
      mockWebSocket.readyState = WS_OPEN;
      mockWebSocket.onopen?.();
      
      await connectPromise;
      expect(client.isConnected).toBe(true);
    });

    it('should build URL with query params', async () => {
      client = new SignalingClient({
        url: 'wss://signal.example.com',
        roomId: 'room-123',
        userId: 'user-456'
      });
      
      const connectPromise = client.connect();
      
      // 检查 WebSocket 构造参数
      expect(global.WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('room=room-123')
      );
      expect(global.WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('user=user-456')
      );
      
      // 触发连接完成
      mockWebSocket.readyState = WS_OPEN;
      mockWebSocket.onopen?.();
      await connectPromise;
    });
  });

  describe('disconnect', () => {
    it('should disconnect from server', async () => {
      client = new SignalingClient({ url: 'wss://signal.example.com' });
      
      const connectPromise = client.connect();
      mockWebSocket.readyState = WS_OPEN;
      mockWebSocket.onopen?.();
      await connectPromise;

      client.disconnect();
      expect(mockWebSocket.close).toHaveBeenCalled();
      expect(client.isConnected).toBe(false);
    });
  });

  describe('send', () => {
    it('should send message when connected', async () => {
      client = new SignalingClient({ url: 'wss://signal.example.com' });
      
      const connectPromise = client.connect();
      mockWebSocket.readyState = WS_OPEN;
      mockWebSocket.onopen?.();
      await connectPromise;

      const message: ISignalingMessage = { type: 'ping' };
      client.send(message);
      expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    it('should throw error when not connected', () => {
      client = new SignalingClient({ url: 'wss://signal.example.com' });
      expect(() => client.send({ type: 'ping' })).toThrow(
        'WebSocket is not connected'
      );
    });
  });

  describe('callbacks', () => {
    it('should call onConnect callback', async () => {
      const onConnect = vi.fn();
      client = new SignalingClient({ url: 'wss://signal.example.com' });
      client.setCallbacks({ onConnect });
      
      const connectPromise = client.connect();
      mockWebSocket.readyState = WS_OPEN;
      mockWebSocket.onopen?.();
      await connectPromise;

      expect(onConnect).toHaveBeenCalled();
    });

    it('should call onMessage callback', async () => {
      const onMessage = vi.fn();
      client = new SignalingClient({ url: 'wss://signal.example.com' });
      client.setCallbacks({ onMessage });
      
      const connectPromise = client.connect();
      mockWebSocket.readyState = WS_OPEN;
      mockWebSocket.onopen?.();
      await connectPromise;

      const message = { type: 'offer' as const, data: {} };
      mockWebSocket.onmessage?.({ data: JSON.stringify(message) });
      expect(onMessage).toHaveBeenCalledWith(message);
    });

    it('should ignore pong messages', async () => {
      const onMessage = vi.fn();
      client = new SignalingClient({ url: 'wss://signal.example.com' });
      client.setCallbacks({ onMessage });
      
      const connectPromise = client.connect();
      mockWebSocket.readyState = WS_OPEN;
      mockWebSocket.onopen?.();
      await connectPromise;

      mockWebSocket.onmessage?.({ data: JSON.stringify({ type: 'pong' }) });
      expect(onMessage).not.toHaveBeenCalled();
    });
  });

  describe('isConnected', () => {
    it('should return true when connected', async () => {
      client = new SignalingClient({ url: 'wss://signal.example.com' });
      
      const connectPromise = client.connect();
      mockWebSocket.readyState = WS_OPEN;
      mockWebSocket.onopen?.();
      await connectPromise;

      expect(client.isConnected).toBe(true);
    });

    it('should return false when not connected', () => {
      client = new SignalingClient({ url: 'wss://signal.example.com' });
      expect(client.isConnected).toBe(false);
    });
  });
});