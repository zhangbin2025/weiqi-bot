/**
 * @fileoverview 信令客户端 - WebSocket 信令服务器连接管理
 */

import type { ISignalingMessage, SignalingMessageType } from './types';

/** 信令客户端配置 */
export interface ISignalingClientConfig {
  url: string;
  roomId?: string | undefined;
  heartbeatInterval?: number | undefined;
  reconnectInterval?: number | undefined;
  maxReconnectAttempts?: number | undefined;
}

/** 信令客户端回调 */
export interface ISignalingClientCallbacks {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onMessage?: (message: ISignalingMessage) => void;
  onError?: (error: Error) => void;
  onHeartbeatTimeout?: () => void; // 心跳超时回调
  onTurnCredentials?: (credentials: { urls: string; username: string; credential: string }) => void; // TURN 凭证回调
}

/**
 * 信令客户端
 * @ai-example
 * const client = new SignalingClient({ url: 'wss://api.weiqi.lol/ws/signal' });
 * client.setCallbacks({ onMessage: (msg) => console.log(msg) });
 * await client.connect('ROOM123');
 */
export class SignalingClient {
  private url: string;
  private ws: WebSocket | null = null;
  private heartbeatInterval?: ReturnType<typeof setInterval> | undefined;
  private reconnectAttempts = 0;
  private maxReconnectAttempts: number;
  private reconnectInterval: number;
  private heartbeatMs: number;
  private missedHeartbeats = 0; // 未收到的心跳计数
  private callbacks: ISignalingClientCallbacks = {};
  private roomId: string | null = null;

  constructor(config: ISignalingClientConfig) {
    this.url = config.url;
    this.heartbeatMs = config.heartbeatInterval ?? 5000;
    this.reconnectInterval = config.reconnectInterval ?? 3000;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 3;
  }

  async connect(roomId: string): Promise<void> {
    this.roomId = roomId;
    const fullUrl = `${this.url}?room=${roomId}`;
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(fullUrl);
      const timeout = setTimeout(() => {
        this.ws?.close();
        reject(new Error('连接超时'));
      }, 10000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.callbacks.onConnect?.();
        resolve();
      };

      this.ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('WebSocket 连接错误'));
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        this.callbacks.onDisconnect?.();
        this.handleReconnect();
      };

      this.ws.onmessage = (e) => this.handleMessage(e.data);
    });
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  send(message: ISignalingMessage): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 未连接');
    }
    this.ws.send(JSON.stringify(message));
  }

  setCallbacks(callbacks: ISignalingClientCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data) as ISignalingMessage & { turn?: { urls: string; username: string; credential: string } };
      if (msg.type === 'pong') {
        // 收到 pong，重置心跳计数
        this.missedHeartbeats = 0;
        return;
      }
      
      // 处理 connected 消息中的 TURN 凭证
      if (msg.type === 'connected' && msg.turn) {
        this.callbacks.onTurnCredentials?.(msg.turn);
      }
      
      this.callbacks.onMessage?.(msg);
    } catch {
      this.callbacks.onError?.(new Error('消息解析失败'));
    }
  }

  private startHeartbeat(): void {
    // 重置心跳计数
    this.missedHeartbeats = 0;
    
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected) {
        // 增加未收到心跳的计数
        this.missedHeartbeats++;
        
        // 连续3次未收到 pong，认为连接断开
        if (this.missedHeartbeats > 3) {
          this.stopHeartbeat();
          this.ws?.close();
          this.callbacks.onHeartbeatTimeout?.();
          return;
        }
        
        // 发送 ping
        this.send({ type: 'ping' });
      }
    }, this.heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.callbacks.onError?.(new Error('重连次数已达上限'));
      return;
    }
    this.reconnectAttempts++;
    setTimeout(() => {
      if (this.roomId) {
        this.connect(this.roomId).catch((err) => this.callbacks.onError?.(err));
      }
    }, this.reconnectInterval);
  }
}