/**
 * 信令客户端
 * @description 管理 WebSocket 信令服务器连接
 * @ai-example
 * const client = new SignalingClient('wss://signal.example.com');
 * client.onMessage((msg) => console.log('Received:', msg));
 * await client.connect();
 */

import type { IWebSocketOptions } from '../../interfaces';
import type { SignalingMessageData } from './SignalingTypes';
import { HeartbeatManager } from './HeartbeatManager';
import { ReconnectManager } from './ReconnectManager';

/**
 * 信令消息类型
 */
export type SignalingMessageType =
  | 'join' | 'leave' | 'offer' | 'answer' | 'ice' | 'ping' | 'pong';

/**
 * 信令消息
 */
export interface ISignalingMessage {
  type: SignalingMessageType;
  data?: SignalingMessageData;
  roomId?: string;
  userId?: string;
  timestamp?: number;
}

/**
 * 信令客户端配置
 */
export interface ISignalingClientConfig {
  url: string;
  roomId?: string | undefined;
  userId?: string | undefined;
  wsOptions?: IWebSocketOptions | undefined;
  heartbeatInterval?: number | undefined;
  reconnectInterval?: number | undefined;
  maxReconnectAttempts?: number | undefined;
}

/**
 * 信令客户端事件回调
 */
export interface ISignalingClientCallbacks {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onMessage?: (message: ISignalingMessage) => void;
  onError?: (error: Error) => void;
}

/**
 * 信令客户端
 */
export class SignalingClient {
  private url: string;
  private roomId?: string | undefined;
  private userId?: string | undefined;
  private wsOptions?: IWebSocketOptions | undefined;

  private ws: WebSocket | null = null;
  private heartbeat: HeartbeatManager;
  private reconnect: ReconnectManager;
  private callbacks: ISignalingClientCallbacks = {};

  constructor(config: ISignalingClientConfig) {
    this.url = config.url;
    this.roomId = config.roomId;
    this.userId = config.userId;
    this.wsOptions = config.wsOptions;
    this.heartbeat = new HeartbeatManager(config.heartbeatInterval);
    this.reconnect = new ReconnectManager(
      config.maxReconnectAttempts,
      config.reconnectInterval
    );
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const fullUrl = this.buildUrl();
      this.ws = new WebSocket(fullUrl);

      const timeout = this.wsOptions?.timeout ?? 10000;
      const timer = setTimeout(() => {
        this.ws?.close();
        reject(new Error('Connection timeout'));
      }, timeout);

      this.ws.onopen = () => {
        clearTimeout(timer);
        this.reconnect.reset();
        this.startHeartbeat();
        this.callbacks.onConnect?.();
        resolve();
      };

      this.ws.onerror = () => {
        clearTimeout(timer);
        this.callbacks.onError?.(new Error('WebSocket error'));
        reject(new Error('WebSocket error'));
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        this.callbacks.onDisconnect?.();
        this.handleReconnect();
      };

      this.ws.onmessage = (event) => this.handleMessage(event.data);
    });
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  send(message: ISignalingMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    this.ws.send(JSON.stringify(message));
  }

  setCallbacks(callbacks: ISignalingClientCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private buildUrl(): string {
    const params = new URLSearchParams();
    if (this.roomId) params.append('room', this.roomId);
    if (this.userId) params.append('user', this.userId);
    const separator = this.url.includes('?') ? '&' : '?';
    return params.toString() ? `${this.url}${separator}${params}` : this.url;
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as ISignalingMessage;
      if (message.type === 'pong') return;
      this.callbacks.onMessage?.(message);
    } catch {
      this.callbacks.onError?.(new Error('Failed to parse message'));
    }
  }

  private startHeartbeat(): void {
    this.heartbeat.start(() => {
      if (this.isConnected) this.send({ type: 'ping' });
    });
  }

  private stopHeartbeat(): void {
    this.heartbeat.stop();
  }

  private handleReconnect(): void {
    const success = this.reconnect.attempt(() => {
      this.connect().catch((error) => this.callbacks.onError?.(error));
    });

    if (!success) {
      this.callbacks.onError?.(new Error('Max reconnect attempts reached'));
    }
  }
}
