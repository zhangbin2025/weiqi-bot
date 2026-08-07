/**
 * 信令消息处理器
 * @description 处理信令服务器的消息
 */

import type { ISignalingMessage } from './SignalingClient';
import type {
  IOfferMessageData,
  IAnswerMessageData,
  IIceMessageData
} from './SignalingTypes';
import type { PeerConnectionManager } from './PeerConnectionManager';
import type { DataChannelManager } from './DataChannelManager';

/**
 * 信令消息处理器
 */
export class SignalingMessageHandler {
  constructor(
    private peerConnection: PeerConnectionManager,
    private dataChannelManager: DataChannelManager,
    private send: (message: ISignalingMessage) => void,
    private onError: (error: Error) => void
  ) {}

  /**
   * 处理信令消息
   */
  async handle(message: ISignalingMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'offer':
          await this.handleOffer(message.data as IOfferMessageData);
          break;
        case 'answer':
          await this.handleAnswer(message.data as IAnswerMessageData);
          break;
        case 'ice':
          await this.handleIce(message.data as IIceMessageData);
          break;
      }
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * 处理 Offer 消息
   */
  private async handleOffer(data: IOfferMessageData): Promise<void> {
    await this.peerConnection.setRemoteDescription({
      type: 'offer',
      sdp: data.sdp
    } as RTCSessionDescriptionInit);
    const answer = await this.peerConnection.createAnswer();
    this.send({
      type: 'answer',
      data: answer
    });
  }

  /**
   * 处理 Answer 消息
   */
  private async handleAnswer(data: IAnswerMessageData): Promise<void> {
    await this.peerConnection.setRemoteDescription({
      type: 'answer',
      sdp: data.sdp
    } as RTCSessionDescriptionInit);
    const channel = this.peerConnection.getDataChannel();
    if (channel) {
      this.dataChannelManager.attach(channel);
    }
  }

  /**
   * 处理 ICE 消息
   */
  private async handleIce(data: IIceMessageData): Promise<void> {
    await this.peerConnection.addIceCandidate({
      candidate: data.candidate,
      sdpMid: data.sdpMid,
      sdpMLineIndex: data.sdpMLineIndex
    } as RTCIceCandidateInit);
  }
}
