/**
 * @fileoverview 真人对弈草稿类型定义
 */

import type { PlayerColor } from '../../../domain';

/**
 * 真人对弈草稿
 * @description 用于持久化对局状态，支持刷新页面后恢复
 */
export interface HHPlayDraft {
  /** 房间 ID */
  roomId: string;

  /** 是否为创建方 */
  isCreator: boolean;

  /** 我的名称 */
  myName: string;

  /** 我的颜色 */
  myColor: PlayerColor;

  /** 对手名称 */
  opponentName: string;

  /** 每方用时（分钟） */
  timeLimit: number;

  /** 让子数 */
  handicap: number;

  /** SGF 格式棋谱 */
  sgf: string;

  /** 黑方剩余时间（秒） */
  blackTime: number;

  /** 白方剩余时间（秒） */
  whiteTime: number;

  /** 当前执棋方 */
  currentPlayer: PlayerColor;

  /** 最后落子时间戳（毫秒） */
  lastMoveTimestamp: number;

  /** 最后一手是否为 Pass */
  lastMoveWasPass: boolean;

  /** 是否在对局中 */
  inGame: boolean;

  /** 对局是否结束 */
  gameEnded: boolean;

  /** 对局是否已放弃 */
  abandoned?: boolean;
}

/**
 * 草稿存储键
 */
export const DRAFT_KEY = 'hh:draft';
