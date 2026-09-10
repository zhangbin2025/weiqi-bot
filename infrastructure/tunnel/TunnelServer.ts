/**
 * @fileoverview 隧道服务端
 * @description 无人值守：固定密码=房间号，无限重连，等待客户端接入
 *
 * 信令流程（与 HH 对弈一致，服务端=创建方）：
 * 1. connect(password) 连接信令
 * 2. 收到 connected → 发 { type: 'create' } 注册为创建方
 * 3. 收到 ready → 发 { type: 'room-info', name, color, ... }（触发客户端发 join-confirm）
 * 4. 收到 join-confirm → createOffer → 发 offer
 * 5. 收到 answer → P2P 建连
 * 6. 客户端发 auth → 验证密码 → auth-ok
 * 7. rpc-request → 分发到 handler → rpc-response
 * 8. 连接断开 → 回到步骤 3 等待下一次接入
 * 9. 信令断开 → 指数退避重连 → 回步骤 1
 */

import { SignalingClient } from '../../services/play/hh/SignalingClient';
import { PeerConnection } from '../../services/play/hh/PeerConnection';
import type { IIceServer } from '../../infrastructure/config/schemas/PlayConfigSchema';
import type {
  ITunnelConfig,
  TunnelConnectionState,
  TunnelStateCallback,
  IRpcHandler,
  TunnelService,
  TunnelMessage,
  IAuthMessage,
  IRpcRequestMessage,
  IRpcCancelMessage,
  LogEntry,
  TunnelLogLevel,
  ClientRecord,
  RpcStat,
  TunnelServerStats,
} from './types';

/** 默认 ICE 服务器 */
const DEFAULT_ICE_SERVERS: IIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/** 最大重连退避时间（毫秒） */
const MAX_RECONNECT_DELAY = 30_000;
/** 初始重连延迟 */
const INITIAL_RECONNECT_DELAY = 3_000;

/** 日志环形缓冲区最大条数 */
const MAX_LOGS = 100;
/** 客户端接入记录最大条数 */
const MAX_CLIENT_HISTORY = 20;

export class TunnelServer {
  private signaling: SignalingClient;
  private peerConnection: PeerConnection | null = null;
  private config: ITunnelConfig;
  private iceServers: IIceServer[];
  private handlers = new Map<TunnelService, IRpcHandler>();
  private activeRequests = new Map<string, AbortController>();

  private state: TunnelConnectionState = 'disconnected';
  private stateCallback: TunnelStateCallback | null = null;

  private reconnectDelay = INITIAL_RECONNECT_DELAY;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private authenticated = false;
  private turnCredentials: { urls: string; username: string; credential: string } | null = null;

  // ─── 监控数据 ───
  private startedAt: number = Date.now();
  private totalConnections: number = 0;
  private clientHistory: ClientRecord[] = [];
  private rpcStats: Map<string, RpcStat> = new Map();
  private recentLogs: LogEntry[] = [];
  private currentClientId: string | null = null;
  private currentClientConnectedAt: number | null = null;
  private currentClientRpcCount: number = 0;

  constructor(config: ITunnelConfig, iceServers?: IIceServer[]) {
    this.config = config;
    this.iceServers = iceServers ?? DEFAULT_ICE_SERVERS;
    this.signaling = new SignalingClient({
      url: config.signalingUrl,
      maxReconnectAttempts: 999,
      reconnectInterval: 3_000,
    });
  }

  /** 注册 RPC 处理器 */
  registerHandler(handler: IRpcHandler): void {
    this.handlers.set(handler.serviceName, handler);
    console.log('[TunnelServer] Handler registered: ' + handler.serviceName);
  }

  /** 设置状态变更回调 */
  onStateChange(callback: TunnelStateCallback): void {
    this.stateCallback = callback;
  }

  /** 启动服务端 */
  async start(): Promise<void> {
    this.destroyed = false;
    this.startedAt = Date.now();
    this.log('info', '服务端启动，密码: ' + this.config.password[0] + '***' + this.config.password.slice(-1));
    console.log('[TunnelServer] Starting with password:', this.config.password[0] + '***' + this.config.password.slice(-1));
    await this.connectSignaling();
  }

  /** 停止服务端 */
  stop(): void {
    this.destroyed = true;
    this.log('info', '服务端停止');
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.cleanupPeer();
    this.signaling.disconnect();
    this.setState('disconnected');
  }

  /** 获取当前状态 */
  getState(): TunnelConnectionState {
    return this.state;
  }

  /** 获取监控数据 */
  getStats(): TunnelServerStats {
    return {
      state: this.state,
      mode: 'server',
      password: this.config.password,
      connectedClients: this.authenticated ? 1 : 0,
      totalConnections: this.totalConnections,
      clientHistory: [...this.clientHistory],
      rpcStats: Array.from(this.rpcStats.values()),
      recentLogs: [...this.recentLogs],
      startedAt: this.startedAt,
    };
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
    console.log('[TunnelServer] ' + prefix + ' ' + message);
  }

  /** 记录 RPC 调用统计 */
  private recordRpc(service: string, method: string, durationMs: number): void {
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
    this.currentClientRpcCount++;
  }

  /** 记录客户端接入 */
  private recordClientConnect(remoteAddress?: string): void {
    this.totalConnections++;
    this.currentClientId = 'client-' + this.totalConnections + '-' + Date.now();
    this.currentClientConnectedAt = Date.now();
    this.currentClientRpcCount = 0;
    this.log('info', '客户端接入 #' + this.totalConnections + (remoteAddress ? ' (' + remoteAddress + ')' : ''));
  }

  /** 记录客户端断开 */
  private recordClientDisconnect(): void {
    if (this.currentClientId && this.currentClientConnectedAt) {
      const record: ClientRecord = {
        id: this.currentClientId,
        connectedAt: this.currentClientConnectedAt,
        disconnectedAt: Date.now(),
        rpcCount: this.currentClientRpcCount,
      };
      this.clientHistory.push(record);
      if (this.clientHistory.length > MAX_CLIENT_HISTORY) {
        this.clientHistory.shift();
      }
      this.log('info', '客户端断开 #' + this.totalConnections + '（RPC 调用 ' + this.currentClientRpcCount + ' 次）');
    }
    this.currentClientId = null;
    this.currentClientConnectedAt = null;
    this.currentClientRpcCount = 0;
  }

  private async connectSignaling(): Promise<void> {
    if (this.destroyed) return;
    this.setState('connecting');
    try {
      this.signaling.setCallbacks({
        onConnect: () => {
          this.reconnectDelay = INITIAL_RECONNECT_DELAY;
          if (!this.signaling.isConnected) {
            this.log('warn', '信令 onConnect 回调时 WebSocket 已断开，跳过 create');
            return;
          }
          console.log('[TunnelServer] Signaling connected, sending create...');
          this.log('info', '信令已连接');
          this.signaling.send({ type: 'create' });
          this.setState('signaling-ok');
        },
        onDisconnect: () => {
          console.log('[TunnelServer] Signaling disconnected, will reconnect...');
          this.log('warn', '信令断开，准备重连');
          this.cleanupPeer();
          this.scheduleReconnect();
        },
        onMessage: (msg) => this.handleSignalingMessage(msg),
        onError: (err) => {
          console.error('[TunnelServer] Signaling error:', err.message);
          this.log('error', '信令错误: ' + err.message);
        },
        onHeartbeatTimeout: () => {
          console.warn('[TunnelServer] Heartbeat timeout, reconnecting...');
          this.log('warn', '信令心跳超时');
          this.cleanupPeer();
          this.signaling.disconnect();
          this.scheduleReconnect();
        },
        onTurnCredentials: (credentials) => {
          this.turnCredentials = credentials;
          console.log('[TunnelServer] TURN credentials received');
        },
      });
      await this.signaling.connect(this.config.password);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[TunnelServer] Failed to connect signaling:', err);
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
    console.log('[TunnelServer] Reconnecting in ' + delaySec + 's...');
    this.reconnectTimer = setTimeout(() => {
      this.connectSignaling();
    }, delay);
  }

  private async handleSignalingMessage(msg: any): Promise<void> {
    switch (msg.type) {
      case 'connected':
        break;
      case 'ready':
        if (!this.signaling.isConnected) {
          this.log('warn', '收到 ready 但信令已断开，跳过 room-info');
          break;
        }
        console.log('[TunnelServer] Received ready, sending room-info...');
        this.signaling.send({
          type: 'room-info',
          name: 'tunnel-server',
          color: 'black',
          handicap: 0,
          timeLimit: 0,
        });
        break;
      case 'join-confirm':
        console.log('[TunnelServer] Received join-confirm from client, initiating P2P...');
        this.log('info', '客户端确认加入，发起 P2P 连接');
        await this.initiateP2P();
        break;
      case 'answer':
        console.log('[TunnelServer] Received answer from client');
        await this.peerConnection?.handleAnswer(msg.data);
        break;
      case 'ice':
        await this.peerConnection?.addIceCandidate(msg.data);
        break;
    }
  }

  /** 服务端主动发起 P2P 连接（createOffer） */
  private async initiateP2P(): Promise<void> {
    this.cleanupPeer();
    this.authenticated = false;

    const iceServers = [...this.iceServers];
    if (this.turnCredentials) {
      iceServers.push(this.turnCredentials as any);
    }

    this.peerConnection = new PeerConnection({ iceServers });
    this.peerConnection.setCallbacks({
      onOpen: () => {
        console.log('[TunnelServer] P2P data channel open, waiting for auth...');
        this.setState('authenticating');
        this.startHeartbeat();
      },
      onClose: () => {
        console.log('[TunnelServer] P2P data channel closed');
        this.log('info', 'P2P 数据通道关闭');
        if (this.authenticated) {
          this.recordClientDisconnect();
        }
        this.cleanupPeer();
        this.setState('signaling-ok');
      },
      onData: (data) => this.handleTunnelMessage(data as any),
      onConnectionStateChange: (state) => {
        console.log('[TunnelServer] P2P state:', state);
        if (state === 'failed' || state === 'closed') {
          if (this.authenticated) {
            this.recordClientDisconnect();
          }
          this.cleanupPeer();
          this.setState('signaling-ok');
        }
      },
      onIceCandidate: (candidate) => {
        this.signaling.send({ type: 'ice', data: candidate });
      },
    });

    const offer = await this.peerConnection.createOffer();
    this.signaling.send({ type: 'offer', data: offer });
    console.log('[TunnelServer] Offer sent');
  }

  private handleTunnelMessage(msg: TunnelMessage): void {
    switch (msg.type) {
      case 'auth':
        this.handleAuth(msg as IAuthMessage);
        break;
      case 'rpc-request':
        this.handleRpcRequest(msg as IRpcRequestMessage);
        break;
      case 'rpc-cancel':
        this.handleRpcCancel(msg as IRpcCancelMessage);
        break;
      case 'ping':
        this.send({ type: 'pong' });
        break;
    }
  }

  private handleAuth(msg: IAuthMessage): void {
    if (msg.password === this.config.password) {
      this.authenticated = true;
      this.recordClientConnect();
      this.send({ type: 'auth-ok' });
      this.setState('connected');
      this.log('info', '客户端认证成功');
      console.log('[TunnelServer] Client authenticated');
    } else {
      this.send({ type: 'auth-fail', reason: '密码错误' });
      this.setState('auth-failed');
      this.log('warn', '客户端认证失败：密码错误');
      console.warn('[TunnelServer] Client auth failed: wrong password');
      setTimeout(() => this.cleanupPeer(), 1000);
    }
  }

  private async handleRpcRequest(msg: IRpcRequestMessage): Promise<void> {
    if (!this.authenticated) {
      this.send({ type: 'rpc-response', id: msg.id, error: '未认证' });
      return;
    }

    const handler = this.handlers.get(msg.service as TunnelService);
    if (!handler) {
      this.send({ type: 'rpc-response', id: msg.id, error: '未知服务: ' + msg.service });
      this.log('warn', 'RPC 未知服务: ' + msg.service);
      return;
    }

    const controller = new AbortController();
    this.activeRequests.set(msg.id, controller);
    const startTime = Date.now();

    try {
      const result = await handler.handle(msg.method, msg.params, (data) => {
        this.send({ type: 'rpc-progress', id: msg.id, data });
      });
      const duration = Date.now() - startTime;
      this.recordRpc(msg.service, msg.method, duration);
      this.log('info', 'RPC: ' + msg.service + '.' + msg.method + ' (' + duration + 'ms)');
      this.send({ type: 'rpc-response', id: msg.id, result });
    } catch (err) {
      const duration = Date.now() - startTime;
      this.recordRpc(msg.service, msg.method, duration);
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log('error', 'RPC 错误: ' + msg.service + '.' + msg.method + ' - ' + errMsg);
      this.send({
        type: 'rpc-response',
        id: msg.id,
        error: errMsg,
      });
    } finally {
      this.activeRequests.delete(msg.id);
    }
  }

  private handleRpcCancel(msg: IRpcCancelMessage): void {
    const controller = this.activeRequests.get(msg.id);
    if (controller) {
      controller.abort();
      this.activeRequests.delete(msg.id);
    }
    for (const handler of this.handlers.values()) {
      handler.cancel?.(msg.id);
    }
  }

  private send(msg: TunnelMessage): void {
    this.peerConnection?.send(msg as any);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping' });
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
    for (const controller of this.activeRequests.values()) {
      controller.abort();
    }
    this.activeRequests.clear();
  }

  private setState(state: TunnelConnectionState, info?: string): void {
    this.state = state;
    this.stateCallback?.(state, info);
  }
}
