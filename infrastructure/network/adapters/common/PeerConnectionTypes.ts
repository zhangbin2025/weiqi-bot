/**
 * PeerConnection 类型定义
 */

/**
 * ICE 服务器配置
 */
export interface IIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * PeerConnection 配置
 */
export interface IPeerConnectionConfig {
  /** ICE 服务器配置 */
  iceServers?: (IIceServer | undefined)[];

  /** DataChannel 名称 */
  dataChannelLabel?: string | undefined;

  /** DataChannel 配置 */
  dataChannelOptions?: RTCDataChannelInit | undefined;
}

/**
 * PeerConnection 事件回调
 */
export interface IPeerConnectionCallbacks {
  /** ICE 候选生成 */
  onIceCandidate?: (candidate: RTCIceCandidateInit) => void;

  /** 连接状态变化 */
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;

  /** ICE 连接状态变化 */
  onIceConnectionStateChange?: (state: RTCIceConnectionState) => void;

  /** DataChannel 创建 */
  onDataChannel?: (channel: RTCDataChannel) => void;

  /** 发生错误 */
  onError?: (error: Error) => void;
}