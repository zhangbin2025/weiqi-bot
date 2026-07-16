/**
 * SignalingMessageHandler 单元测试
 */

import { SignalingMessageHandler } from '../SignalingMessageHandler';
import type { ISignalingMessage } from '../SignalingClient';
import type { PeerConnectionManager } from '../PeerConnectionManager';
import type { DataChannelManager } from '../DataChannelManager';

describe('SignalingMessageHandler', () => {
  let handler: SignalingMessageHandler;
  let mockPeerConnection: jest.Mocked<PeerConnectionManager>;
  let mockDataChannelManager: jest.Mocked<DataChannelManager>;
  let mockSend: jest.Mock;
  let mockOnError: jest.Mock;

  beforeEach(() => {
    mockPeerConnection = {
      setRemoteDescription: jest.fn(),
      createAnswer: jest.fn(),
      addIceCandidate: jest.fn(),
      getDataChannel: jest.fn()
    } as unknown as jest.Mocked<PeerConnectionManager>;

    mockDataChannelManager = {
      attach: jest.fn()
    } as unknown as jest.Mocked<DataChannelManager>;

    mockSend = jest.fn();
    mockOnError = jest.fn();

    handler = new SignalingMessageHandler(
      mockPeerConnection,
      mockDataChannelManager,
      mockSend,
      mockOnError
    );
  });

  describe('handle', () => {
    describe('offer message', () => {
      it('should handle offer message', async () => {
        const message: ISignalingMessage = {
          type: 'offer',
          data: {
            type: 'offer',
            sdp: 'test-sdp'
          }
        };

        mockPeerConnection.createAnswer.mockResolvedValue({
          type: 'answer',
          sdp: 'answer-sdp'
        });

        await handler.handle(message);

        expect(mockPeerConnection.setRemoteDescription).toHaveBeenCalledWith({
          type: 'offer',
          sdp: 'test-sdp'
        });
        expect(mockPeerConnection.createAnswer).toHaveBeenCalled();
        expect(mockSend).toHaveBeenCalledWith({
          type: 'answer',
          data: {
            type: 'answer',
            sdp: 'answer-sdp'
          }
        });
      });
    });

    describe('answer message', () => {
      it('should handle answer message', async () => {
        const message: ISignalingMessage = {
          type: 'answer',
          data: {
            type: 'answer',
            sdp: 'test-sdp'
          }
        };

        await handler.handle(message);

        expect(mockPeerConnection.setRemoteDescription).toHaveBeenCalledWith({
          type: 'answer',
          sdp: 'test-sdp'
        });
      });

      it('should attach DataChannel when available', async () => {
        const message: ISignalingMessage = {
          type: 'answer',
          data: {
            type: 'answer',
            sdp: 'test-sdp'
          }
        };

        const mockChannel = {} as RTCDataChannel;
        mockPeerConnection.getDataChannel.mockReturnValue(mockChannel);

        await handler.handle(message);

        expect(mockDataChannelManager.attach).toHaveBeenCalledWith(mockChannel);
      });
    });

    describe('ice message', () => {
      it('should handle ice message', async () => {
        const message: ISignalingMessage = {
          type: 'ice',
          data: {
            candidate: 'test-candidate',
            sdpMid: '0',
            sdpMLineIndex: 0
          }
        };

        await handler.handle(message);

        expect(mockPeerConnection.addIceCandidate).toHaveBeenCalledWith({
          candidate: 'test-candidate',
          sdpMid: '0',
          sdpMLineIndex: 0
        });
      });
    });

    describe('error handling', () => {
      it('should call onError when error occurs', async () => {
        const message: ISignalingMessage = {
          type: 'offer',
          data: {
            type: 'offer',
            sdp: 'test-sdp'
          }
        };

        const error = new Error('Test error');
        mockPeerConnection.setRemoteDescription.mockRejectedValue(error);

        await handler.handle(message);

        expect(mockOnError).toHaveBeenCalledWith(error);
      });
    });
  });
});
