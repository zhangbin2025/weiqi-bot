/**
 * PeerConnectionManager 单元测试 - 连接创建部分
 */

import { PeerConnectionManager } from '../PeerConnectionManager';

describe('PeerConnectionManager - Connection', () => {
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

  describe('createConnection', () => {
    it('should create RTCPeerConnection', async () => {
      await manager.createConnection();

      expect(global.RTCPeerConnection).toHaveBeenCalledWith({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
    });

    it('should setup event handlers', async () => {
      await manager.createConnection();

      expect(mockPeerConnection.onicecandidate).not.toBeNull();
      expect(mockPeerConnection.onconnectionstatechange).not.toBeNull();
      expect(mockPeerConnection.oniceconnectionstatechange).not.toBeNull();
      expect(mockPeerConnection.ondatachannel).not.toBeNull();
    });
  });

  describe('createOffer', () => {
    it('should create offer', async () => {
      await manager.createConnection();
      const offer = await manager.createOffer();

      expect(offer.type).toBe('offer');
      expect(offer.sdp).toBe('test-sdp');
      expect(mockPeerConnection.createOffer).toHaveBeenCalled();
      expect(mockPeerConnection.setLocalDescription).toHaveBeenCalled();
    });

    it('should create DataChannel', async () => {
      await manager.createConnection();
      await manager.createOffer();

      expect(mockPeerConnection.createDataChannel).toHaveBeenCalledWith(
        'data',
        undefined
      );
    });

    it('should throw error when connection not created', async () => {
      await expect(manager.createOffer()).rejects.toThrow(
        'PeerConnection not created'
      );
    });
  });

  describe('createAnswer', () => {
    it('should create answer', async () => {
      await manager.createConnection();
      const answer = await manager.createAnswer();

      expect(answer.type).toBe('answer');
      expect(answer.sdp).toBe('test-sdp');
      expect(mockPeerConnection.createAnswer).toHaveBeenCalled();
      expect(mockPeerConnection.setLocalDescription).toHaveBeenCalled();
    });

    it('should throw error when connection not created', async () => {
      await expect(manager.createAnswer()).rejects.toThrow(
        'PeerConnection not created'
      );
    });
  });

  describe('close', () => {
    it('should close connection and data channel', async () => {
      await manager.createConnection();
      await manager.createOffer();
      manager.close();

      expect(mockDataChannel.close).toHaveBeenCalled();
      expect(mockPeerConnection.close).toHaveBeenCalled();
    });
  });
});