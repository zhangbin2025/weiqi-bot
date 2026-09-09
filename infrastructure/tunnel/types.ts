/**
 * @fileoverview 远程隧道类型定义
 * @description RPC 消息类型、隧道配置、service 枚举
 */

// ─── Service 枚举 ───

/** 可用的远程服务 */
export type TunnelService = 'katago' | 'fetcher' | string;

// ─── RPC 消息协议 ───

/** 隧道消息类型 */
export type TunnelMessageType =
  | 'auth'          // 客户端 → 服务端：密码验证
  | 'auth-ok'       // 服务端 → 客户端：验证通过
  | 'auth-fail'     // 服务端 → 客户端：验证失败
  | 'rpc-request'   // 客户端 → 服务端：RPC 请求
  | 'rpc-response'  // 服务端 → 客户端：RPC 响应
  | 'rpc-progress'  // 服务端 → 客户端：进度更新
  | 'rpc-cancel'    // 客户端 → 服务端：取消请求
  | 'ping'          // 心跳
  | 'pong';         // 心跳响应

/** 隧道基础消息 */
export interface ITunnelMessage {
  type: TunnelMessageType;
  [key: string]: unknown;
}

/** 认证消息 */
export interface IAuthMessage extends ITunnelMessage {
  type: 'auth';
  password: string;
}

/** 认证结果消息 */
export interface IAuthResultMessage extends ITunnelMessage {
  type: 'auth-ok' | 'auth-fail';
  reason?: string;
}

/** RPC 请求消息 */
export interface IRpcRequestMessage extends ITunnelMessage {
  type: 'rpc-request';
  id: string;
  service: TunnelService;
  method: string;
  params: unknown;
}

/** RPC 响应消息 */
export interface IRpcResponseMessage extends ITunnelMessage {
  type: 'rpc-response';
  id: string;
  result?: unknown;
  error?: string;
}

/** RPC 进度消息 */
export interface IRpcProgressMessage extends ITunnelMessage {
  type: 'rpc-progress';
  id: string;
  data: unknown;
}

/** RPC 取消消息 */
export interface IRpcCancelMessage extends ITunnelMessage {
  type: 'rpc-cancel';
  id: string;
}

/** 心跳消息 */
export interface IHeartbeatMessage extends ITunnelMessage {
  type: 'ping' | 'pong';
}

/** 所有隧道消息联合类型 */
export type TunnelMessage =
  | IAuthMessage
  | IAuthResultMessage
  | IRpcRequestMessage
  | IRpcResponseMessage
  | IRpcProgressMessage
  | IRpcCancelMessage
  | IHeartbeatMessage;

// ─── RPC Handler 接口 ───

/** RPC 处理器接口 — 服务端注册的服务需实现此接口 */
export interface IRpcHandler {
  /** 服务名称 */
  readonly serviceName: TunnelService;
  /** 处理 RPC 调用 */
  handle(method: string, params: unknown, onProgress?: (data: unknown) => void): Promise<unknown>;
  /** 取消正在执行的请求（可选） */
  cancel?(requestId: string): void;
}

// ─── 隧道配置 ───

/** 隧道运行模式 */
export type TunnelMode = 'none' | 'server' | 'client';

/** 隧道配置（持久化到 localStorage） */
export interface ITunnelConfig {
  /** 运行模式 */
  mode: TunnelMode;
  /** 密码（同时作为房间号） */
  password: string;
  /** 信令服务器 URL */
  signalingUrl: string;
}

/** 默认配置 */
export const DEFAULT_TUNNEL_CONFIG: ITunnelConfig = {
  mode: 'none',
  password: '',
  signalingUrl: 'wss://api.weiqi.lol/ws/signal',
};

// ─── 连接状态 ───

/** 隧道连接状态 */
export type TunnelConnectionState =
  | 'disconnected'   // 未连接
  | 'connecting'     // 正在连接信令
  | 'signaling-ok'   // 信令已连接，等待 P2P
  | 'authenticating' // P2P 已连接，正在验证密码
  | 'connected'      // 已认证，可正常使用
  | 'auth-failed'    // 密码错误
  | 'error';         // 错误

/** 状态变更回调 */
export type TunnelStateCallback = (state: TunnelConnectionState, info?: string) => void;
