/**
 * WebRTC P2P 连接接口
 * @description 定义 WebRTC 点对点连接的接口
 * @ai-example
 * const p2p = await provider.createP2PConnection({
 *   signalingUrl: 'wss://signal.example.com',
 *   roomId: 'game-123'
 * });
 * p2p.onData((data) => console.log('Received:', data));
 * p2p.send('Hello P2P');
 */

/**
 * WebRTC 连接状态
 */
export type RTCPeerConnectionState =
  | 'new'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed';

/**
 * ICE 连接状态
 */
export type RTCIceConnectionState =
  | 'new'
  | 'checking'
  | 'connected'
  | 'completed'
  | 'failed'
  | 'disconnected'
  | 'closed';

/**
 * ICE 候选类型
 */
export interface RTCIceCandidateInit {
  /** 候选字符串 */
  candidate?: string | undefined;

  /** SDP 中间标识 */
  sdpMid?: string | null | undefined;

  /** SDP 媒体索引 */
  sdpMLineIndex?: number | null | undefined;

  /** 用户名片段 */
  usernameFragment?: string | undefined;
}

/**
 * SDP 描述类型
 */
export interface RTCSessionDescriptionInit {
  /** SDP 类型 */
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';

  /** SDP 内容 */
  sdp?: string | undefined;
}

/**
 * WebRTC 配置
 */
export interface IWebRTCConfig {
  /** 信令服务器 URL */
  signalingUrl: string;

  /** 房间 ID */
  roomId: string;

  /** ICE 服务器配置 */
  iceServers?: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }>;

  /** 连接超时（毫秒） */
  timeout?: number;

  /** 心跳间隔（毫秒） */
  heartbeatInterval?: number;

  /** 自定义元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * WebRTC P2P 连接接口
 */
export interface IWebRTC {
  /** 连接状态 */
  readonly connectionState: RTCPeerConnectionState;

  /** ICE 连接状态 */
  readonly iceConnectionState: RTCIceConnectionState;

  /** 本地 SDP */
  readonly localDescription: RTCSessionDescriptionInit | null;

  /** 远程 SDP */
  readonly remoteDescription: RTCSessionDescriptionInit | null;

  /**
   * 设置本地描述
   * @param description - SDP 描述
   */
  setLocalDescription(
    description: RTCSessionDescriptionInit
  ): Promise<void>;

  /**
   * 设置远程描述
   * @param description - SDP 描述
   */
  setRemoteDescription(
    description: RTCSessionDescriptionInit
  ): Promise<void>;

  /**
   * 添加 ICE candidate
   * @param candidate - ICE 候选
   */
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;

  /**
   * 创建 Offer
   */
  createOffer(): Promise<RTCSessionDescriptionInit>;

  /**
   * 创建 Answer
   */
  createAnswer(): Promise<RTCSessionDescriptionInit>;

  /**
   * 发送数据（通过 DataChannel）
   * @param data - 数据内容
   */
  send(data: string | ArrayBuffer): void;

  /**
   * 监听数据
   * @param callback - 数据回调函数
   */
  onData(callback: (data: string | ArrayBuffer) => void): void;

  /**
   * 关闭连接
   */
  close(): void;
}
