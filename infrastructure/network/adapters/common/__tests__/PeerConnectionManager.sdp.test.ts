/**
 * PeerConnectionManager 单元测试 - SDP 和 ICE 处理
 */

import { PeerConnectionManager } from '../PeerConnectionManager';

describe('PeerConnectionManager - SDP/ICE', () => {
  let manager: PeerConnectionManager;
  let mockPeerConnection: any;
  let mockDataChannel: any;

  beforeEach(() => {
    mockDataChannel = {
      close: jest.fn()
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

    global.RTCPeerConnection = jest.fn().mockImplementation(() => mockPeerConnection) as any;
    global.RTCSessionDescription = jest.fn().mockImplementation((desc) => desc) as any;
    global.RTCIceCandidate = jest.fn().mockImplementation((cand) => cand) as any;

    manager = new PeerConnectionManager({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
  });

  afterEach(() => {
    manager.close();
  });

  describe('setRemoteDescription', () => {
    it('should set remote description', async () => {
      await manager.createConnection();
      await manager.setRemoteDescription({
        type: 'offer',
        sdp: 'remote-sdp'
      });

      expect(mockPeerConnection.setRemoteDescription).toHaveBeenCalled();
    });

    it('should throw error when connection not created', async () => {
      await expect(
        manager.setRemoteDescription({ type: 'offer', sdp: 'test' })
      ).rejects.toThrow('PeerConnection not created');
    });
  });

  describe('addIceCandidate', () => {
    it('should add ICE candidate', async () => {
      await manager.createConnection();
      await manager.addIceCandidate({
        candidate: 'test-candidate',
        sdpMid: '0'
      });

      expect(mockPeerConnection.addIceCandidate).toHaveBeenCalled();
    });

    it('should throw error when connection not created', async () => {
      await expect(
        manager.addIceCandidate({ candidate: 'test' })
      ).rejects.toThrow('PeerConnection not created');
    });
  });

  describe('getDataChannel', () => {
    it('should return data channel', async () => {
      await manager.createConnection();
      await manager.createOffer();

      const channel = manager.getDataChannel();
      expect(channel).toBe(mockDataChannel);
    });
  });

  describe('getConnectionState', () => {
    it('should return connection state', async () => {
      await manager.createConnection();
      mockPeerConnection.connectionState = 'connected';

      expect(manager.getConnectionState()).toBe('connected');
    });

    it('should return closed when connection not created', () => {
      expect(manager.getConnectionState()).toBe('closed');
    });
  });
});