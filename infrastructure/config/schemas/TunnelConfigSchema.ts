/**
 * @fileoverview 隧道配置模式
 * @description 远程隧道的配置结构和默认值
 */

import type { IConfigSchemaDefinition } from '../interfaces';
import type { TunnelService } from '../../tunnel/types';


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
  /** 客户端模式：启用的远程服务列表，默认全部开启 */
  remoteServices?: TunnelService[];
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
  remoteServices: {
    type: 'array',
    required: false,
    default: ['katago', 'fetcher', 'debug'],
    description: '客户端模式启用的远程服务列表',
  },
};
