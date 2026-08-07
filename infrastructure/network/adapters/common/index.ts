/**
 * 通用网络适配器导出
 */

export { BaseProvider } from './BaseProvider';
export { UnsupportedProvider, createUnsupportedProvider } from './UnsupportedProvider';
export { UnsupportedSnifferProvider } from './UnsupportedSnifferProvider';
export { RequestBuilder } from './RequestBuilder';
export {
  getRequest,
  postRequest,
  putRequest,
  deleteRequest,
  patchRequest,
  fromConfig
} from './RequestBuilderFactory';

// WebRTC 相关
export { SignalingClient, type ISignalingClientConfig, type ISignalingMessage } from './SignalingClient';
export { PeerConnectionManager } from './PeerConnectionManager';
export type { IPeerConnectionConfig, IPeerConnectionCallbacks } from './PeerConnectionTypes';
export { DataChannelManager } from './DataChannelManager';
export { WebRTCProvider, type IWebRTCProviderConfig } from './WebRTCProvider';
export { createWebRTCWrapper } from './WebRTCWrapper';
export { SignalingMessageHandler } from './SignalingMessageHandler';
export { HeartbeatManager } from './HeartbeatManager';
export { ReconnectManager } from './ReconnectManager';
export type { SignalingMessageData, IOfferMessageData, IAnswerMessageData, IIceMessageData } from './SignalingTypes';
