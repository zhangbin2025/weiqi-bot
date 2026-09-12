/**
 * @fileoverview 隧道模块入口
 * @description 远程隧道：通过 WebRTC 连接两个 weiqi-bot 实例
 */

// 类型导出
export type {
  ITunnelConfig,
  TunnelMode,
  TunnelConnectionState,
  TunnelStateCallback,
  TunnelService,
  IRpcHandler,
  TunnelMessage,
} from './types';

// 默认配置
export { DEFAULT_TUNNEL_CONFIG } from './types';

// 核心类
export { TunnelServer } from './TunnelServer';
export { TunnelClient } from './TunnelClient';
export { KatagoRpcHandler } from './KatagoRpcHandler';
export { FetcherRpcHandler } from './FetcherRpcHandler';
export { DebugRpcHandler } from './DebugRpcHandler';
export { TunnelManager } from './TunnelManager';

// 适配器
export { KataGoRemoteAdapter, createKataGoRemoteAdapter } from '../ai/adapters/KataGoRemoteAdapter';
