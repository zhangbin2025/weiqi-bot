/**
 * AI自对弈草稿类型定义
 */

import type { PlayerColor } from '../../../domain';

/** AI自对弈草稿 */
export interface MMPlayDraft {
  /** 棋盘状态（二维数组） */
  board: (PlayerColor | null)[][];
  /** 当前玩家 */
  currentPlayer: PlayerColor;
  /** 手数 */
  moveCount: number;
  /** 历史记录 */
  moveHistory: Array<{ x: number; y: number; color: PlayerColor }>;
  /** 游戏是否结束 */
  gameEnded: boolean;
  /** 黑方得分 */
  blackScore?: number | undefined;
  /** 白方得分 */
  whiteScore?: number | undefined;
  /** 模型ID */
  modelId: string;
  /** 模型URL（自定义模型需要保存完整 URL） */
  modelUrl?: string;
  /** 计算量 */
  visits: number;
  /** 对弈速度 */
  speed: string;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/** 草稿存储键 */
export const MM_PLAY_DRAFT_KEY = 'weiqi-mm-play-draft';
