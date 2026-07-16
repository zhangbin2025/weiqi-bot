/**
 * PeerConnectionManager 单元测试 - 事件回调
 */

import { PeerConnectionManager } from '../PeerConnectionManager';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

describe('PeerConnectionManager - Callbacks', () => {
  let manager: PeerConnectionManager;
  let mockPeerConnection: any;
  let mockDataChannel: any;

  beforeEach(() => {
    mockDataChannel = {
      close: vi.fn(),
      send: vi.fn(),
      label: 'data',
      readyState: 'open'
    };

    mockPeerConnection = {
      createDataChannel: jest.fn().mockReturnValue(mockDataChannel),
      createOffer: jest.fn().mockResolvedValue({ type: 'offer', sdp: 'test-sdp' }),
      createAnswer: jest.fn().mockResolvedValue({ type: 'answer', sdp: 'test-sdp' }),
      setLocalDescription: jest.fn(),
      setRemoteDescription: jest.fn(),
      addIceCandidate: jest.fn(),
      close: jest.fn(),
      connectionState: 'new',
      iceConnectionState: 'new',
      onicecandidate: null,
      onconnectionstatechange: null,
      oniceconnectionstatechange: null,
      ondatachannel: null
    };

    global.RTCPeerConnection = vi.fn().mockImplementation(() => mockPeerConnection) as any;
    global.RTCSessionDescription = vi.fn().mockImplementation((desc) => desc) as any;
    global.RTCIceCandidate = vi.fn().mockImplementation((cand) => cand) as any;

    manager = new PeerConnectionManager({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
  });

  afterEach(() => {
    manager.close();
  });

  describe('callbacks', () => {
    it('should call onIceCandidate callback', async () => {
      const callback = vi.fn();
      manager.setCallbacks({ onIceCandidate: callback });
      await manager.createConnection();

      const candidate = { candidate: 'test-candidate' };
      mockPeerConnection.onicecandidate?.({ candidate });

      expect(callback).toHaveBeenCalled();
    });

    it('should call onConnectionStateChange callback', async () => {
      const callback = vi.fn();
      manager.setCallbacks({ onConnectionStateChange: callback });
      await manager.createConnection();

      mockPeerConnection.connectionState = 'connected';
      mockPeerConnection.onconnectionstatechange?.();

      expect(callback).toHaveBeenCalledWith('connected');
    });

    it('should call onIceConnectionStateChange callback', async () => {
      const callback = vi.fn();
      manager.setCallbacks({ onIceConnectionStateChange: callback });
      await manager.createConnection();

      mockPeerConnection.iceConnectionState = 'connected';
      mockPeerConnection.oniceconnectionstatechange?.();

      expect(callback).toHaveBeenCalledWith('connected');
    });

    it('should call onDataChannel callback', async () => {
      const callback = vi.fn();
      manager.setCallbacks({ onDataChannel: callback });
      await manager.createConnection();

      const channel = { close: vi.fn() } as unknown as RTCDataChannel;
      mockPeerConnection.ondatachannel?.({ channel });

      expect(callback).toHaveBeenCalledWith(channel);
    });

    it('should merge callbacks when setCallbacks called multiple times', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      manager.setCallbacks({ onConnectionStateChange: callback1 });
      manager.setCallbacks({ onIceCandidate: callback2 });
      await manager.createConnection();

      mockPeerConnection.connectionState = 'connected';
      mockPeerConnection.onconnectionstatechange?.();

      expect(callback1).toHaveBeenCalledWith('connected');
    });
  });
});