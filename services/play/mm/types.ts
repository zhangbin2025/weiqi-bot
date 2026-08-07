import type { PlayerColor } from '../../../domain';
export type { PlayerColor };
/**
 * @fileoverview AI 自对弈类型定义
 */

import type { BoardState } from '../../../domain/board';

/** 玩家颜色 */

/** 自对弈速度 */
export type PlaySpeed = 'instant' | 'fast' | 'normal' | 'slow';

/** AI 自对弈配置 */
export interface IMMPlayConfig {
  /** AI 模型 ID */
  modelId: string;

  /** visits 数 */
  visits: number;

  /** 对弈速度 */
  speed: PlaySpeed;

  /** 最大手数（可选） */
  maxMoves?: number;

  /** 是否保存棋谱 */
  saveSgf?: boolean;

  /** 模型 URL（可选，支持子目录部署） */
  modelUrl?: string | undefined;

  /** 模型下载进度回调 */
  onProgress?: ((loaded: number, total: number, progress: number) => void) | undefined;
}

/** 自对弈状态 */
export interface IMMPlayState {
  /** 棋盘状态 */
  board: BoardState;

  /** 当前玩家 */
  currentPlayer: PlayerColor;

  /** 历史记录 */
  moveHistory: MoveRecord[];

  /** 当前手数 */
  currentMove: number;

  /** 是否运行中 */
  isRunning: boolean;

  /** 是否暂停 */
  isPaused: boolean;

  /** 对局是否结束 */
  gameEnded: boolean;

  /** 黑方提子数 */
  capturedBlack?: number | undefined;

  /** 白方提子数 */
  capturedWhite?: number | undefined;

  /** 黑方得分 */
  blackScore?: number | undefined;

  /** 白方得分 */
  whiteScore?: number | undefined;
}

/** 落子记录 */
export interface MoveRecord {
  /** X 坐标 */
  x: number;

  /** Y 坐标 */
  y: number;

  /** 玩家颜色 */
  color: PlayerColor;

  /** 手数 */
  moveNum: number;
}

/** AI 自对弈回调接口 - re-exported from IMMPlayService */
export type { IMMPlayCallbacks } from './IMMPlayService';
