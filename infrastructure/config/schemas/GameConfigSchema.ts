/**
 * Game 模块配置模式
 * @description 定义 Game 模块的配置结构和默认值
 */

import type { IConfigSchemaDefinition } from '../interfaces';
import { Platform } from '../interfaces';

/**
 * Game 模块配置
 */
export interface IGameConfig {
  /** Cloudflare Worker 代理地址 */
  proxyUrl: string;
  /** 野狐 API 基础 URL */
  foxwqBaseUrl: string;
  /** 野狐棋谱基础 URL */
  foxwqChessBaseUrl: string;
  /** 野狐公开棋谱 URL */
  foxwqPublicQipuUrl: string;
  /** OGS API 基础 URL */
  ogsApiUrl: string;
  /** 101围棋网基础 URL */
  weiqi101BaseUrl: string;
  /** 是否启用 WebSocket（用于 101围棋） */
  enableWebSocket: boolean;
  /** 超时时间（毫秒） */
  timeout: number;
  /** 腾讯围棋 API URL */
  txwqApiUrl: string;
  /** 弈客围棋基础 URL */
  yikeBaseUrl: string;
  /** 1919围棋基础 URL */
  weiqi1919BaseUrl: string;
  /** izis围棋基础 URL */
  izisBaseUrl: string;
  /** 新博对弈基础 URL */
  xinboduiyiBaseUrl: string;
  /** 手谈基础 URL */
  shoutanApiUrl: string;
  /** 弈城围棋 API URL */
  yichengApiUrl: string;
  /** 弈客少儿 API URL */
  yikeShaoerApiUrl: string;
  /** 元萝卜 API URL */
  yuanluoboApiUrl: string;

  /** 棋谱缓存 TTL（毫秒），默认 1 小时 */
  gameCacheTTL: number;

  /** 是否启用棋谱缓存，默认 true */
  enableGameCache: boolean;
}

/**
 * Game 配置模式
 */
export const GameConfigSchema: IConfigSchemaDefinition<IGameConfig> = {
  proxyUrl: {
    type: 'string',
    required: true,
    default: 'https://api.weiqi.lol',
    description: 'Cloudflare Worker 代理地址',
  },
  foxwqBaseUrl: {
    type: 'string',
    required: true,
    default: 'https://newframe.foxwq.com/cgi',
    description: '野狐 API 基础 URL',
  },
  foxwqChessBaseUrl: {
    type: 'string',
    required: true,
    default: 'https://h5.foxwq.com/yehuDiamond/chessbook_local',
    description: '野狐棋谱基础 URL',
  },
  foxwqPublicQipuUrl: {
    type: 'string',
    required: true,
    default: 'https://www.foxwq.com/qipu.html',
    description: '野狐公开棋谱 URL',
  },
  ogsApiUrl: {
    type: 'string',
    required: true,
    default: 'https://online-go.com/api/v1',
    description: 'OGS API 基础 URL',
  },
  weiqi101BaseUrl: {
    type: 'string',
    required: true,
    default: 'https://www.101weiqi.com',
    description: '101围棋网基础 URL',
  },
  enableWebSocket: {
    type: 'boolean',
    required: true,
    default: true,
    description: '是否启用 WebSocket（用于 101围棋）',
  },
  timeout: {
    type: 'number',
    default: 30000,
    required: true,
    description: '请求超时时间（毫秒）',
    minValue: 5000,
    maxValue: 60000,
    validate: (value: number) => value >= 5000 && value <= 60000,
    platformOverrides: {
      [Platform.Mobile]: 45000,
      [Platform.MiniProgram]: 45000,
    },
  },
  txwqApiUrl: {
    type: 'string',
    required: true,
    default: 'https://h5.txwq.qq.com',
    description: '腾讯围棋 API URL',
  },
  yikeBaseUrl: {
    type: 'string',
    required: true,
    default: 'https://home.yikeweiqi.com',
    description: '弈客围棋基础 URL',
  },
  weiqi1919BaseUrl: {
    type: 'string',
    required: true,
    default: 'https://m.19x19.com',
    description: '1919围棋基础 URL',
  },
  izisBaseUrl: {
    type: 'string',
    required: true,
    default: 'http://app.izis.cn',
    description: 'izis围棋基础 URL',
  },
  xinboduiyiBaseUrl: {
    type: 'string',
    required: true,
    default: 'https://www.xinboduiyi.com',
    description: '新博对弈基础 URL',
  },
  shoutanApiUrl: {
    type: 'string',
    required: true,
    default: 'https://v.dzqzd.com/Kifu/Details',
    description: '手谈 API URL',
  },
  yichengApiUrl: {
    type: 'string',
    required: true,
    default: 'http://client.eweiqi.com/gibo/gibo_load_data.php',
    description: '弈城围棋 API URL',
  },
  yikeShaoerApiUrl: {
    type: 'string',
    required: true,
    default: 'https://mo.yikeweiqi.com/yikemo/anon/ayalyse/init',
    description: '弈客少儿 API URL',
  },
  yuanluoboApiUrl: {
    type: 'string',
    required: true,
    default: 'https://jupiter.yuanluobo.com/r2/chess/wq/sdr/v3/record/detail',
    description: '元萝卜 API URL',
  },
  gameCacheTTL: {
    type: 'number',
    required: false,
    description: '棋谱缓存 TTL（毫秒）',
    defaultValue: 3600000, // 1 小时
    minValue: 0,
  },
  enableGameCache: {
    type: 'boolean',
    required: false,
    description: '是否启用棋谱缓存',
    defaultValue: true,
  },
};
