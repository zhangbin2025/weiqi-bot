/**
 * @fileoverview AI 控制器接口
 */

import type { BoardState, PlayerColor } from '../../domain';
import type { Difficulty, IAnalysisResult } from './types';

/**
 * AI 控制器接口
 *
 * 管理 AI 引擎的调用，支持初始化、落子生成、形势判断等功能。
 */
export interface IAIController {
  /**
   * 初始化 AI 引擎
   * @param modelId - 模型 ID
   * @param modelUrl - 模型 URL（可选）
   * @param onProgress - 进度回调（可选，模型下载）
   * @param onInitProgress - 初始化进度回调（可选，KataGo tuning）
   */
  init(
    modelId: string,
    modelUrl?: string,
    onProgress?: (loaded: number, total: number, progress: number) => void,
    onInitProgress?: (info: { stage: string; message: string; current?: number; total?: number }) => void
  ): Promise<void>;

  /**
   * 生成 AI 落子
   * @param board - 当前棋盘
   * @param previousBoard - 前一棋盘（可选，用于劫争检测）
   * @param currentPlayer - 当前玩家
   * @param moveHistory - 历史着法
   * @param komi - 贴目
   * @param visits - 搜索深度/访问次数（可选，不传则使用内部默认值）
   * @param maxTimeMs - 最大思考时间（可选）
   * @param initialStones - 初始棋子（让子等，可选）
   */
  genmove(
    board: BoardState,
    previousBoard: BoardState | null,
    currentPlayer: PlayerColor,
    moveHistory: Array<{ x: number; y: number; player: PlayerColor }>,
    komi: number,
    visits?: number,
    maxTimeMs?: number,
    initialStones?: Array<{ player: PlayerColor; x: number; y: number }>
  ): Promise<{ x: number; y: number } | null>;

  /**
   * 分析局面
   * @param board - 当前棋盘
   * @param previousBoard - 前一棋盘（可选）
   * @param currentPlayer - 当前玩家
   * @param moveHistory - 历史着法
   * @param komi - 贴目
   * @param visits - 访问次数（可选）
   * @param maxTimeMs - 最大思考时间（可选）
   * @param analysisPvLen - PV长度（可选，0表示不获取PV，提高速度）
   * @param initialStones - 初始棋子（让子等，可选）
   */
  analyze(
    board: BoardState,
    previousBoard: BoardState | null,
    currentPlayer: PlayerColor,
    moveHistory: Array<{ x: number; y: number; player: PlayerColor }>,
    komi: number,
    visits?: number,
    maxTimeMs?: number,
    analysisPvLen?: number,
    initialStones?: Array<{ player: PlayerColor; x: number; y: number }>
  ): Promise<IAnalysisResult>;

  /**
   * 数子（形势判断）
   * @param board - 当前棋盘
   * @param moveHistory - 历史着法
   * @param komi - 贴目
   * @returns 领先目数（黑方视角）
   */
  countTerritory(
    board: BoardState,
    moveHistory: Array<{ x: number; y: number; player: PlayerColor }>,
    komi: number
  ): Promise<number>;

  /**
   * 取消当前思考
   */
  cancel(): void;

  /**
   * 是否在思考
   */
  isThinking(): boolean;

  /**
   * 设置难度
   */
  setDifficulty(difficulty: Difficulty): void;

  /**
   * 获取难度
   */
  getDifficulty(): Difficulty;

  /**
   * 是否已初始化
   */
  isInitialized(): boolean;

  /**
   * 获取当前模型文件名
   * @description 从 URL 中提取文件名，用于区分不同的模型
   */
  getModelFileName(): string | null;

  /**
   * 批量评估局面（不使用MCTS，速度快但准确性低）
   * @param positions - 位置列表
   * @returns 每个位置的评估结果
   */
  evaluateBatch(
    positions: Array<{
      board: BoardState;
      previousBoard?: BoardState | null;
      currentPlayer: PlayerColor;
      moveHistory: Array<{ x: number; y: number; player: PlayerColor }>;
      komi: number;
    }>
  ): Promise<Array<{ winRate: number; scoreLead: number }>>;

  /**
   * 整盘批量分析
   *
   * 一次请求分析整盘棋的所有（或指定）回合。
   * App 端走原生批量路径，性能最优；
   * Web 端逐手串行 fallback。
   *
   * @param moves 着法列表
   * @param komi 贴目
   * @param options 分析选项
   * @returns 每个回合的分析结果
   */
  analyzeGame(
    moves: Array<{ player: PlayerColor; x: number; y: number }>,
    komi: number,
    options?: {
      visits?: number;
      analyzeTurns?: number[];
      includeOwnership?: boolean;
      includePv?: boolean;
      rules?: string;
      initialStones?: Array<{ player: PlayerColor; x: number; y: number }>;
      onResultProgress?: (current: number, total: number) => void;
    }
  ): Promise<Array<{
    turnNumber: number;
    winRate: number;
    scoreLead: number;
    visits: number;
    topMoves: Array<{
      move: string;
      winRate: number;
      scoreLead: number;
      visits: number;
      prior: number;
      pv: string[];
    }>;
    ownership?: number[];
  }>>;

  /**
   * 销毁控制器
   */
  destroy(): void;
}
