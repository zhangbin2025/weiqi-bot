/**
 * WebRTC 网络提供者
 * @description 提供 WebRTC P2P 连接功能
 * @ai-example
 * const provider = new WebRTCProvider({
 *   signalingUrl: 'wss://signal.example.com',
 *   roomId: 'room-123'
 * });
 * await provider.createP2PConnection(config);
 * provider.send('Hello P2P');
 */

import { BaseProvider } from './BaseProvider';
import { SignalingClient } from './SignalingClient';
import { PeerConnectionManager } from './PeerConnectionManager';
import { DataChannelManager } from './DataChannelManager';
import { createWebRTCWrapper } from './WebRTCWrapper';
import { SignalingMessageHandler } from './SignalingMessageHandler';
import type {
  IWebRTC,
  IWebRTCConfig,
  IRequestConfig,
  IResponse,
  IWebSocket,
  IWebSocketOptions
} from '../../interfaces';
import { NetworkError, Environment } from '../../interfaces';

/**
 * WebRTC 提供者配置
 */
export interface IWebRTCProviderConfig {
  signalingUrl: string;
  roomId?: string;
  userId?: string;
  iceServers?: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }>;
  dataChannelLabel?: string;
}

/**
 * WebRTC 提供者事件回调
 */
export interface IWebRTCProviderCallbacks {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onData?: (data: string | ArrayBuffer) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onError?: (error: Error) => void;
}

/**
 * WebRTC 网络提供者
 */
export class WebRTCProvider extends BaseProvider {
  private config: IWebRTCProviderConfig;
  private signalingClient: SignalingClient;
  private peerConnection: PeerConnectionManager;
  private dataChannelManager: DataChannelManager;
  private messageHandler: SignalingMessageHandler;
  private callbacks: IWebRTCProviderCallbacks = {};

  constructor(config: IWebRTCProviderConfig) {
    super({
      name: 'WebRTCProvider',
      priority: 50,
      supportedEnvironments: [Environment.WEB, Environment.DESKTOP]
    });

    this.config = config;
    this.signalingClient = new SignalingClient({
      url: config.signalingUrl,
      roomId: config.roomId,
      userId: config.userId
    });
    this.peerConnection = new PeerConnectionManager({
      iceServers: config.iceServers as RTCIceServer[] | undefined,
      dataChannelLabel: config.dataChannelLabel as string | undefined
    } as any);
    this.dataChannelManager = new DataChannelManager();
    this.messageHandler = new SignalingMessageHandler(
      this.peerConnection,
      this.dataChannelManager,
      (msg) => this.signalingClient.send(msg),
      (error) => this.callbacks.onError?.(error)
    );
  }

  override async createP2PConnection(config: IWebRTCConfig): Promise<IWebRTC> {
    try {
      await this.signalingClient.connect();
      await this.peerConnection.createConnection();
      this.setupEventHandlers();
      return createWebRTCWrapper(
        this.peerConnection,
        this.dataChannelManager,
        (data) => this.send(data),
        () => this.disconnect()
      );
    } catch (error) {
      throw new NetworkError(
        'Failed to create P2P connection',
        'WEBRTC_ERROR',
        this.name
      );
    }
  }

  send(data: string | ArrayBuffer): void {
    this.dataChannelManager.send(data);
  }

  setCallbacks(callbacks: IWebRTCProviderCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  disconnect(): void {
    this.dataChannelManager.close();
    this.peerConnection.close();
    this.signalingClient.disconnect();
  }

  async request<T>(config: IRequestConfig): Promise<IResponse<T>> {
    throw new NetworkError(
      'WebRTC provider does not support HTTP requests',
      'NOT_SUPPORTED',
      this.name
    );
  }

  override async connect(url: string, options?: IWebSocketOptions): Promise<IWebSocket> {
    throw new NetworkError(
      'WebRTC provider does not support WebSocket connections',
      'NOT_SUPPORTED',
      this.name
    );
  }

  override async healthCheck(): Promise<boolean> {
    return this.signalingClient.isConnected;
  }

  private setupEventHandlers(): void {
    this.signalingClient.setCallbacks({
      onMessage: (msg) => this.messageHandler.handle(msg),
      onError: (error) => this.callbacks.onError?.(error)
    });

    this.peerConnection.setCallbacks({
      onIceCandidate: (candidate) => {
        this.signalingClient.send({ type: 'ice', data: candidate });
      },
      onConnectionStateChange: (state) => {
        this.callbacks.onConnectionStateChange?.(state);
      },
      onDataChannel: (channel) => {
        this.dataChannelManager.attach(channel);
        this.callbacks.onConnect?.();
      },
      onError: (error) => this.callbacks.onError?.(error)
    });

    this.dataChannelManager.setCallbacks({
      onData: (data) => this.callbacks.onData?.(data),
      onOpen: () => this.callbacks.onConnect?.(),
      onClose: () => this.callbacks.onDisconnect?.(),
      onError: (error) => this.callbacks.onError?.(error)
    });
  }
}
