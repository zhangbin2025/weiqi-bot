/**
 * @fileoverview 隧道配置模式
 * @description 远程隧道的配置结构和默认值
 */

import type { IConfigSchemaDefinition } from '../interfaces';
import { Platform } from '../interfaces';

/** 隧道运行模式 */
export type TunnelMode = 'none' | 'server' | 'client';

/** 隧道配置 */
export interface ITunnelConfig {
  /** 运行模式：none=关闭, server=服务端, client=客户端 */
  mode: TunnelMode;
  /** 密码（同时作为信令房间号，固定不变） */
  password: string;
  /** 信令服务器 URL */
  signalingUrl: string;
}

/** 隧道配置模式 */
export const TunnelConfigSchema: IConfigSchemaDefinition<ITunnelConfig> = {
  mode: {
    type: 'string',
    required: true,
    default: 'none',
    description: '隧道模式：none=关闭, server=服务端, client=客户端',
  },
  password: {
    type: 'string',
    required: false,
    default: '',
    description: '密码（固定，同时作为信令房间号）',
  },
  signalingUrl: {
    type: 'string',
    required: true,
    default: 'wss://api.weiqi.lol/ws/signal',
    description: '信令服务器 URL',
  },
};
