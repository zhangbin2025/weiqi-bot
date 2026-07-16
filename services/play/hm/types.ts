/**
 * @fileoverview 人机对弈服务类型定义
 */

import type { BoardState, PlayerColor } from '../../../domain';

/** 难度等级 */
export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * 人机对弈配置
 * @ai-example
 * const config: IHMPlayConfig = {
 *   playerColor: 'black',
 *   handicap: 0,
 *   difficulty: 'medium',
 *   noUndo: false,
 *   modelId: 'katago-small'
 * };
 */
export interface IHMPlayConfig {
  /** 玩家执黑还是执白 */
  playerColor: PlayerColor;
  /** 让子数（0-9） */
  handicap: number;
  /** 难度等级 */
  difficulty: Difficulty;
  /** 落子无悔模式 */
  noUndo: boolean;
  /** AI 模型 ID */
  modelId: string;
  /** AI visits 数（可选，覆盖难度默认值） */
  visits?: number;
  /** 模型 URL（可选，支持子目录部署） */
  modelUrl?: string | undefined;
  /** 模型下载进度回调 */
  onProgress?: ((loaded: number, total: number, progress: number) => void) | undefined;
}

/**
 * 游戏状态
 * @ai-example
 * const state: IHMPlayState = {
 *   board: createEmptyBoardState(19),
 *   currentPlayer: 'black',
 *   moveHistory: [],
 *   capturedBlack: 0,
 *   capturedWhite: 0,
 *   scoreLead: 0,
 *   isAiThinking: false,
 *   gameEnded: false
 * };
 */
export interface IHMPlayState {
  /** 当前棋盘 */
  board: BoardState;
  /** 当前执棋方 */
  currentPlayer: PlayerColor;
  /** 历史着法 */
  moveHistory: Array<{ x: number; y: number; player: PlayerColor }>;
  /** 黑方提子数 */
  capturedBlack: number;
  /** 白方提子数 */
  capturedWhite: number;
  /** 领先目数 */
  scoreLead: number;
  /** AI 是否在思考 */
  isAiThinking: boolean;
  /** 游戏是否结束 */
  gameEnded: boolean;
  /** 胜者（游戏结束时） */
  winner?: PlayerColor;
}

/**
 * 形势判断结果
 * @ai-example
 * const result: IAnalysisResult = {
 *   winRate: 0.52,
 *   scoreLead: 1.5,
 *   topMoves: [{ x: 3, y: 3, winRate: 0.53, scoreLead: 1.6, visits: 100 }]
 * };
 */
export interface IAnalysisResult {
  /** 胜率（当前玩家视角，0-1） */
  winRate: number;
  /** 领先目数 */
  scoreLead: number;
  /** 推荐着法 */
  topMoves: IMoveAnalysis[];
}

/**
 * 着法分析
 * @ai-example
 * const move: IMoveAnalysis = { x: 3, y: 3, winRate: 0.53, scoreLead: 1.6, visits: 100 };
 */
export interface IMoveAnalysis {
  x: number;
  y: number;
  winRate: number;
  scoreLead: number;
  visits: number;
}

/**
 * 人机对弈回调
 */
export interface IHMPlayCallbacks {
  /** 棋盘变化 */
  onBoardChange?: (board: BoardState) => void;
  /** 玩家变化 */
  onPlayerChange?: (player: PlayerColor) => void;
  /** AI 思考状态变化 */
  onAiThinking?: (thinking: boolean) => void;
  /** AI 落子 */
  onAiMove?: (x: number, y: number) => void;
  /** 提子 */
  onCapture?: (count: number, color: PlayerColor) => void;
  /** 目数变化 */
  onScoreChange?: (score: number) => void;
  /** 游戏结束 */
  onGameEnd?: (winner: PlayerColor, reason: string) => void;
  /** 错误 */
  onError?: (error: Error) => void;
}
