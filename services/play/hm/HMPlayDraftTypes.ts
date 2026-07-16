/**
 * 人机对弈草稿类型定义
 */

import type { PlayerColor } from '../../../domain';

/** 人机对弈草稿 */
export interface HMPlayDraft {
  /** 棋盘状态（二维数组） */
  board: (PlayerColor | null)[][];
  /** 当前玩家 */
  currentPlayer: PlayerColor;
  /** 玩家执子颜色 */
  playerColor: PlayerColor;
  /** 难度 */
  difficulty: 'easy' | 'medium' | 'hard';
  /** 计算量（visits） */
  visits?: number;
  /** 让子数 */
  handicap: number;
  /** 模型ID */
  modelId: string;
  /** 模型URL（自定义模型需要保存完整 URL） */
  modelUrl?: string;
  /** 手数 */
  moveCount: number;
  /** 历史记录 */
  moveHistory: Array<{ x: number; y: number; player: PlayerColor }>;
  /** 游戏是否结束 */
  gameEnded: boolean;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/** 草稿存储键 */
export const HM_PLAY_DRAFT_KEY = 'weiqi-hm-play-draft';
