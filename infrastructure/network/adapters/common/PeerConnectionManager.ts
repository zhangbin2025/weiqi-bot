/**
 * PeerConnection 管理器
 * @description 管理 RTCPeerConnection，处理 ICE 候选和 SDP 描述
 * @ai-example
 * const manager = new PeerConnectionManager({
 *   iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
 * });
 * const offer = await manager.createOffer();
 */

import type { IPeerConnectionConfig, IPeerConnectionCallbacks } from './PeerConnectionTypes';

/**
 * PeerConnection 管理器
 */
export class PeerConnectionManager {
  private config: IPeerConnectionConfig;
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private callbacks: IPeerConnectionCallbacks = {};

  constructor(config: IPeerConnectionConfig) {
    this.config = config;
  }

  /**
   * 创建 PeerConnection
   */
  async createConnection(): Promise<void> {
    this.pc = new RTCPeerConnection({
      iceServers: this.config.iceServers as RTCIceServer[] | undefined
    } as RTCConfiguration);
    this.setupEventHandlers();
  }

  /**
   * 创建 Offer
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) {
      throw new Error('PeerConnection not created');
    }

    this.dataChannel = this.pc.createDataChannel(
      this.config.dataChannelLabel ?? 'data',
      this.config.dataChannelOptions
    );

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    return {
      type: offer.type as 'offer',
      ...(offer.sdp ? { sdp: offer.sdp } : {})
    };
  }

  /**
   * 创建 Answer
   */
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) {
      throw new Error('PeerConnection not created');
    }

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    return {
      type: answer.type as 'answer',
      ...(answer.sdp ? { sdp: answer.sdp } : {})
    };
  }

  /**
   * 设置远程描述
   */
  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) {
      throw new Error('PeerConnection not created');
    }
    await this.pc.setRemoteDescription(new RTCSessionDescription(description));
  }

  /**
   * 添加 ICE 候选
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc) {
      throw new Error('PeerConnection not created');
    }
    await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  /**
   * 获取 DataChannel
   */
  getDataChannel(): RTCDataChannel | null {
    return this.dataChannel;
  }

  /**
   * 获取连接状态
   */
  getConnectionState(): RTCPeerConnectionState {
    return this.pc?.connectionState ?? 'closed';
  }

  /**
   * 获取 ICE 连接状态
   */
  getIceConnectionState(): RTCIceConnectionState {
    return this.pc?.iceConnectionState ?? 'closed';
  }

  /**
   * 设置事件回调
   */
  setCallbacks(callbacks: IPeerConnectionCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * 关闭连接
   */
  close(): void {
    this.dataChannel?.close();
    this.pc?.close();
    this.dataChannel = null;
    this.pc = null;
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    if (!this.pc) return;

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.callbacks.onIceCandidate?.({
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      this.callbacks.onConnectionStateChange?.(this.pc!.connectionState);
    };

    this.pc.oniceconnectionstatechange = () => {
      this.callbacks.onIceConnectionStateChange?.(this.pc!.iceConnectionState);
    };

    this.pc.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.callbacks.onDataChannel?.(event.channel);
    };
  }
}