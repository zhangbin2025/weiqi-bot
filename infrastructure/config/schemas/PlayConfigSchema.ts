/**
 * 真人对弈配置模式（services/play/hh）
 * @description 定义真人对弈模块的配置结构和默认值
 */

import type { IConfigSchemaDefinition } from '../interfaces';
import { Platform } from '../interfaces';

/**
 * ICE 服务器配置
 */
export interface IIceServer {
  urls: string;
  username?: string;
  credential?: string;
}

/**
 * 真人对弈配置
 */
export interface IPlayConfig {
  /** 信令服务器 URL */
  signalingUrl: string;
  /** 默认每方用时（分钟） */
  defaultTimeLimit: number;
  /** 默认让子数（0-9） */
  defaultHandicap: number;
  /** 是否启用音效 */
  soundEnabled: boolean;
  /** WebRTC ICE 服务器列表 */
  iceServers: IIceServer[];
}

/**
 * 真人对弈配置模式
 */
export const PlayConfigSchema: IConfigSchemaDefinition<IPlayConfig> = {
  signalingUrl: {
    type: 'string',
    required: true,
    default: 'wss://api.weiqi.lol/ws/signal',
    description: '信令服务器 URL',
  },
  defaultTimeLimit: {
    type: 'number',
    required: false,
    description: '默认每方用时（分钟）',
    defaultValue: 30,
    minValue: 1,
    maxValue: 180,
    validate: (value: number) => value >= 1 && value <= 180,
  },
  defaultHandicap: {
    type: 'number',
    required: false,
    description: '默认让子数（0-9）',
    defaultValue: 0,
    minValue: 0,
    maxValue: 9,
    validate: (value: number) => value >= 0 && value <= 9,
  },
  soundEnabled: {
    type: 'boolean',
    required: false,
    description: '是否启用音效',
    defaultValue: true,
  },
  iceServers: {
    type: 'array',
    required: false,
    description: 'WebRTC ICE 服务器列表',
    defaultValue: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
    platformOverrides: {
      [Platform.Mobile]: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
      [Platform.MiniProgram]: [
        { urls: 'stun:stun.l.google.com:19302' },
      ],
    },
  },
};
