/**
 * 人机对弈常量定义
 * @module presentation/pages/play/constants/HMConstants
 */

import { DefaultModelService } from '@services/model';

/**
 * 棋子颜色
 */
export const PLAYER_BLACK = 'black' as const;
export const PLAYER_WHITE = 'white' as const;

/**
 * 默认配置
 */
export const DEFAULT_MODEL_ID = DefaultModelService.getDefaultModelId();
export const DEFAULT_DIFFICULTY = 'medium' as const;

/**
 * 状态消息
 */
export const PLAYER_TURN_MESSAGE = '轮到你落子';
export const AI_THINKING_MESSAGE = 'AI思考中...';
export const GAME_ENDED_MESSAGE = '对局已结束';
export const WAITING_TO_START_MESSAGE = '等待开始...';
export const LOADING_MODEL_MESSAGE = '正在加载模型...';
