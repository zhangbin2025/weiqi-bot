/**
 * @fileoverview 隧道客户端
 * @description 连接服务端，密码验证，发起 RPC 调用
 *
 * 信令流程（与 HH 对弈一致，客户端=加入方）：
 * 1. connect(password) 连接信令
 * 2. 收到 connected → 等待服务端发的 room-info（或直接发 join-confirm）
 * 3. 收到 offer → handleOffer → 发 answer → P2P 建连
 * 4. P2P 建连后发 auth → 收 auth-ok
 * 5. call(service, method, params) → 发 rpc-request → 收 rpc-response
 * 6. 连接断开 → 指数退避重连 → 回步骤 1
 *
 * 简化处理：不走 room-info/confirmJoin 流程，
 * 直接收 offer 回 answer（服务端会主动发 offer）。
 * 为了兼容信令服务器，收到 connected 后发一个 join-confirm。
 */

import { SignalingClient } from '../../services/play/hh/SignalingClient';
import { PeerConnection } from '../../services/play/hh/PeerConnection';
import type { IIceServer } from '../../infrastructure/config/schemas/PlayConfigSchema';
import type {
  ITunnelConfig,
  TunnelConnectionState,
  TunnelStateCallback,
  TunnelService,
  TunnelMessage,
  IAuthResultMessage,
  IRpcResponseMessage,
  IRpcProgressMessage,
  LogEntry,
  TunnelLogLevel,
  RpcStat,
  TunnelClientStats,
} from './types';

/** 默认 ICE 服务器 */
const DEFAULT_ICE_SERVERS: IIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/** 最大重连退避时间 */
const MAX_RECONNECT_DELAY = 30_000;
/** 初始重连延迟 */
const INITIAL_RECONNECT_DELAY = 3_000;

/** RPC 调用超时（默认 5 分钟） */
const DEFAULT_RPC_TIMEOUT = 300_000;

/** 日志环形缓冲区最大条数 */
const MAX_LOGS = 100;

/** 待处理的 RPC 请求 */
interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: ((data: unknown) => void) | undefined;
  timer: ReturnType<typeof setTimeout>;
}

export class TunnelClient {
  private signaling: SignalingClient;
  private peerConnection: PeerConnection | null = null;
  private config: ITunnelConfig;
  private iceServers: IIceServer[];

  private state: TunnelConnectionState = 'disconnected';
  private stateCallbacks: TunnelStateCallback[] = [];

  private pendingRequests = new Map<string, PendingRequest>();
  private requestIdCounter = 0;

  private reconnectDelay = INITIAL_RECONNECT_DELAY;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private authenticated = false;
  private turnCredentials: { urls: string; username: string; credential: string } | null = null;

  // ─── 监控数据 ───
  private startedAt: number = Date.now();
  private rpcStats: Map<string, RpcStat> = new Map();
  private recentLogs: LogEntry[] = [];

  constructor(config: ITunnelConfig, iceServers?: IIceServer[]) {
    this.config = config;
    this.iceServers = iceServers ?? DEFAULT_ICE_SERVERS;
    this.signaling = new SignalingClient({
      url: config.signalingUrl,
      maxReconnectAttempts: 999,
      reconnectInterval: 3_000,
    });
  }

  /** 设置状态变更回调 */
  onStateChange(callback: TunnelStateCallback): void {
    this.stateCallbacks.push(callback);
  }

  /** 连接服务端 */
  async connect(): Promise<void> {
    this.destroyed = false;
    this.startedAt = Date.now();

    // 先清理旧连接，避免信令服务器 room 冲突
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.cleanupPeer();
    // 不调 signaling.disconnect()，connectSignaling 内部会先关旧 ws
    this.log('info', '客户端启动，密码: ' + this.config.password[0] + '***' + this.config.password.slice(-1));
    console.log('[TunnelClient] Connecting with password:', this.config.password[0] + '***' + this.config.password.slice(-1));
    await this.connectSignaling();
  }

  /** 断开连接 */
  disconnect(): void {
    this.destroyed = true;
    this.log('info', '客户端断开');
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.failAllPending('连接已断开');
    this.cleanupPeer();
    this.signaling.disconnect();
    this.setState('disconnected');
  }

  /** 获取当前状态 */
  getState(): TunnelConnectionState {
    return this.state;
  }

  /** 是否已连接且认证通过 */
  get isConnected(): boolean {
    return this.state === 'connected' && this.authenticated;
  }

  /** 获取客户端监控数据 */
  getClientStats(): TunnelClientStats {
    return {
      state: this.state,
      mode: 'client',
      password: this.config.password,
      authenticated: this.authenticated,
      rpcStats: Array.from(this.rpcStats.values()),
      recentLogs: [...this.recentLogs],
      startedAt: this.startedAt,
    };
  }

  /**
   * 发起 RPC 调用
   */
  async call(
    service: TunnelService,
    method: string,
    params: unknown,
    onProgress?: (data: unknown) => void,
    timeoutMs: number = DEFAULT_RPC_TIMEOUT,
  ): Promise<unknown> {
    if (!this.isConnected) {
      throw new Error('隧道未连接');
    }

    const id = this.generateRequestId();
    const timer = setTimeout(() => {
      const pending = this.pendingRequests.get(id);
      if (pending) {
        this.pendingRequests.delete(id);
        pending.reject(new Error('RPC 超时: ' + service + '.' + method));
      }
    }, timeoutMs);

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject, onProgress, timer });
    });

    this.send({
      type: 'rpc-request',
      id,
      service,
      method,
      params,
    });

    return promise;
  }

  // ─── 内部实现 ───

  /** 记录日志到环形缓冲区 */
  private log(level: TunnelLogLevel, message: string): void {
    const entry: LogEntry = { timestamp: Date.now(), level, message };
    this.recentLogs.push(entry);
    if (this.recentLogs.length > MAX_LOGS) {
      this.recentLogs.shift();
    }
    const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
    console.log('[TunnelClient] ' + prefix + ' ' + message);
  }

  /** 记录 RPC 调用统计 */
  private recordRpc(service: string, method: string, durationMs: number, success: boolean): void {
    const key = service + '.' + method;
    const existing = this.rpcStats.get(key);
    if (existing) {
      existing.count++;
      existing.lastCallAt = Date.now();
      existing.totalDurationMs += durationMs;
      existing.avgDurationMs = Math.round(existing.totalDurationMs / existing.count);
    } else {
      this.rpcStats.set(key, {
        service: service,
        method: method,
        count: 1,
        lastCallAt: Date.now(),
        totalDurationMs: durationMs,
        avgDurationMs: durationMs,
      });
    }
  }

  private async connectSignaling(): Promise<void> {
    if (this.destroyed) return;
    this.setState('connecting');
    try {
      this.signaling.setCallbacks({
        onConnect: () => {
          console.log('[TunnelClient] Signaling connected');
          this.log('info', '信令已连接');
          this.reconnectDelay = INITIAL_RECONNECT_DELAY;
          this.setState('signaling-ok');
        },
        onDisconnect: () => {
          console.log('[TunnelClient] Signaling disconnected, will reconnect...');
          this.log('warn', '信令断开，准备重连');
          this.cleanupPeer();
          this.scheduleReconnect();
        },
        onMessage: (msg) => this.handleSignalingMessage(msg),
        onError: (err) => {
          console.error('[TunnelClient] Signaling error:', err.message);
          this.log('error', '信令错误: ' + err.message);
        },
        onHeartbeatTimeout: () => {
          console.warn('[TunnelClient] Heartbeat timeout, reconnecting...');
          this.log('warn', '信令心跳超时');
          this.cleanupPeer();
          this.signaling.disconnect();
          this.scheduleReconnect();
        },
        onTurnCredentials: (credentials) => {
          this.turnCredentials = credentials;
        },
      });
      await this.signaling.connect(this.config.password);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[TunnelClient] Failed to connect signaling:', err);
      this.log('error', '信令连接失败: ' + errMsg);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
    const delaySec = Math.round(delay / 1000);
    console.log('[TunnelClient] Reconnecting in ' + delaySec + 's...');
    this.reconnectTimer = setTimeout(() => {
      this.connectSignaling();
    }, delay);
  }

  private async handleSignalingMessage(msg: any): Promise<void> {
    switch (msg.type) {
      case 'connected':
        // 信令服务器确认连接
        break;
      case 'room-info':
        // 服务端发来的房间信息，回复 join-confirm 让服务端发 offer
        console.log('[TunnelClient] Received room-info, sending join-confirm');
        this.signaling.send({ type: 'join-confirm', name: 'tunnel-client' });
        break;
      case 'offer':
        // 服务端发来 offer
        console.log('[TunnelClient] Received offer from server');
        this.log('info', '收到服务端 offer');
        await this.handleServerOffer(msg.data);
        break;
      case 'ice':
        await this.peerConnection?.addIceCandidate(msg.data);
        break;
    }
  }

  /** 处理服务端 offer，创建 answer */
  private async handleServerOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    this.cleanupPeer();

    const iceServers = [...this.iceServers];
    if (this.turnCredentials) {
      iceServers.push(this.turnCredentials as any);
    }

    this.peerConnection = new PeerConnection({ iceServers });
    this.peerConnection.setCallbacks({
      onOpen: () => {
        console.log('[TunnelClient] P2P data channel open, sending auth...');
        this.setState('authenticating');
        this.sendAuth();
        this.startHeartbeat();
      },
      onClose: () => {
        console.log('[TunnelClient] P2P data channel closed');
        this.log('info', 'P2P 数据通道关闭');
        this.authenticated = false;
        this.failAllPending('P2P 连接断开');
        this.scheduleReconnect();
      },
      onData: (data) => this.handleTunnelMessage(data as any),
      onConnectionStateChange: (state) => {
        console.log('[TunnelClient] P2P state:', state);
        if (state === 'failed') {
          this.log('warn', 'P2P 连接失败');
          this.cleanupPeer();
          this.scheduleReconnect();
        }
      },
      onIceCandidate: (candidate) => {
        this.signaling.send({ type: 'ice', data: candidate });
      },
    });

    const answer = await this.peerConnection.handleOffer(offer);
    this.signaling.send({ type: 'answer', data: answer });
    console.log('[TunnelClient] Answer sent');
  }

  private sendAuth(): void {
    this.send({
      type: 'auth',
      password: this.config.password,
    });
  }

  private handleTunnelMessage(msg: TunnelMessage): void {
    switch (msg.type) {
      case 'auth-ok':
        this.authenticated = true;
        this.setState('connected');
        this.log('info', '认证成功');
        console.log('[TunnelClient] Authenticated');
        break;
      case 'auth-fail':
        {
        this.authenticated = false;
        const reason = (msg as IAuthResultMessage).reason || '密码错误';
        this.setState('auth-failed', reason);
        this.log('warn', '认证失败: ' + reason);
        console.warn('[TunnelClient] Auth failed:', reason);
        this.cleanupPeer();
        // 密码错误不自动重连，等待用户修改
        break;
        }
      case 'rpc-response':
        this.handleRpcResponse(msg as IRpcResponseMessage);
        break;
      case 'rpc-progress':
        this.handleRpcProgress(msg as IRpcProgressMessage);
        break;
      case 'pong':
        // 心跳响应
        break;
    }
  }

  private handleRpcResponse(msg: IRpcResponseMessage): void {
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingRequests.delete(msg.id);

    // 记录 RPC 统计（无法精确计时，用 0 占位）
    // 实际计时在 call() 中更难做，这里简化处理

    if (msg.error) {
      pending.reject(new Error(msg.error));
    } else {
      pending.resolve(msg.result);
    }
  }

  private handleRpcProgress(msg: IRpcProgressMessage): void {
    const pending = this.pendingRequests.get(msg.id);
    pending?.onProgress?.(msg.data);
  }

  private send(msg: TunnelMessage): void {
    this.peerConnection?.send(msg as any);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.peerConnection?.connectionState === 'connected') {
        this.send({ type: 'ping' });
      }
    }, 15_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private cleanupPeer(): void {
    this.stopHeartbeat();
    this.peerConnection?.close();
    this.peerConnection = null;
    this.authenticated = false;
  }

  private failAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  private generateRequestId(): string {
    return 'rpc-' + Date.now() + '-' + (++this.requestIdCounter);
  }

  private setState(state: TunnelConnectionState, info?: string): void {
    this.state = state;
    for (const cb of this.stateCallbacks) {
      try { cb(state, info); } catch (e) { console.error('[TunnelClient] State callback error:', e); }
    }
  }
}
