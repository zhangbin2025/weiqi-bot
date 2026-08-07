/**
 * WebRTCProvider 单元测试
 */

import { WebRTCProvider } from '../WebRTCProvider';
import { Environment, NetworkError } from '../../../interfaces';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

describe('WebRTCProvider', () => {
  let provider: WebRTCProvider;

  beforeEach(() => {
    // Mock WebSocket
    global.WebSocket = vi.fn().mockImplementation(() => ({
      readyState: 1, // OPEN
      send: vi.fn(),
      close: vi.fn(),
      onopen: null,
      onerror: null,
      onclose: null,
      onmessage: null
    })) as any;
    (WebSocket as any).CONNECTING = 0;
    (WebSocket as any).OPEN = 1;

    // Mock RTCPeerConnection
    global.RTCPeerConnection = vi.fn().mockImplementation(() => ({
      createDataChannel: vi.fn().mockReturnValue({ close: vi.fn() }),
      createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'test' }),
      createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'test' }),
      setLocalDescription: vi.fn(),
      setRemoteDescription: vi.fn(),
      addIceCandidate: vi.fn(),
      close: vi.fn(),
      connectionState: 'new',
      iceConnectionState: 'new',
      onicecandidate: null,
      onconnectionstatechange: null,
      oniceconnectionstatechange: null,
      ondatachannel: null
    })) as any;

    provider = new WebRTCProvider({
      signalingUrl: 'wss://signal.example.com',
      roomId: 'room-123',
      userId: 'user-456',
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
  });

  afterEach(() => {
    provider.disconnect();
  });

  describe('constructor', () => {
    it('should create provider with config', () => {
      expect(provider.name).toBe('WebRTCProvider');
      expect(provider.priority).toBe(50);
      expect(provider.supportedEnvironments).toContain(Environment.WEB);
      expect(provider.supportedEnvironments).toContain(Environment.DESKTOP);
    });
  });

  describe('request', () => {
    it('should throw NetworkError (not supported)', async () => {
      await expect(
        provider.request({ url: 'https://example.com' })
      ).rejects.toThrow(NetworkError);
    });
  });

  describe('connect', () => {
    it('should throw NetworkError (not supported)', async () => {
      await expect(
        provider.connect('wss://example.com')
      ).rejects.toThrow(NetworkError);
    });
  });

  describe('healthCheck', () => {
    it('should return false when signaling client is not connected', async () => {
      // signaling client is not actually connected in test environment
      const result = await provider.healthCheck();
      expect(result).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should disconnect without error', () => {
      expect(() => provider.disconnect()).not.toThrow();
    });
  });

  describe('send', () => {
    it('should throw error when DataChannel not ready', () => {
      expect(() => provider.send('test')).toThrow();
    });
  });

  describe('setCallbacks', () => {
    it('should set callbacks', () => {
      const callbacks = {
        onConnect: vi.fn(),
        onDisconnect: vi.fn(),
        onData: vi.fn(),
        onError: vi.fn()
      };
      expect(() => provider.setCallbacks(callbacks)).not.toThrow();
    });
  });
});
