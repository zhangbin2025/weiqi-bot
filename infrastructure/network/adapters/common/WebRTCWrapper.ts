/**
 * WebRTC 包装器
 * @description 创建 IWebRTC 接口的实现
 */

import type { IWebRTC, RTCIceCandidateInit, RTCSessionDescriptionInit } from '../../interfaces';
import type { PeerConnectionManager } from './PeerConnectionManager';
import type { DataChannelManager } from './DataChannelManager';

/**
 * 创建 WebRTC 包装器
 */
export function createWebRTCWrapper(
  peerConnection: PeerConnectionManager,
  dataChannelManager: DataChannelManager,
  send: (data: string | ArrayBuffer) => void,
  disconnect: () => void
): IWebRTC {
  return {
    get connectionState() {
      return peerConnection.getConnectionState();
    },
    get iceConnectionState() {
      return peerConnection.getIceConnectionState();
    },
    get localDescription() {
      return null;
    },
    get remoteDescription() {
      return null;
    },
    async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
      // 已在 createOffer/createAnswer 中处理
    },
    async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
      await peerConnection.setRemoteDescription(description as globalThis.RTCSessionDescriptionInit);
    },
    async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
      await peerConnection.addIceCandidate(candidate as globalThis.RTCIceCandidateInit);
    },
    async createOffer(): Promise<RTCSessionDescriptionInit> {
      return await peerConnection.createOffer();
    },
    async createAnswer(): Promise<RTCSessionDescriptionInit> {
      return await peerConnection.createAnswer();
    },
    send(data: string | ArrayBuffer): void {
      send(data);
    },
    onData(callback: (data: string | ArrayBuffer) => void): void {
      dataChannelManager.setCallbacks({ onData: callback });
    },
    close(): void {
      disconnect();
    }
  };
}
