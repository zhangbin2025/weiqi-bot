/**
 * 决策模块 - 核心类型定义
 * 
 * 用于围棋选点题的类型系统
 */

/** 难度等级 */
export type DecisionDifficulty = 'easy' | 'medium' | 'hard' | 'blunder';

/** 恶手严重程度 */
export type BadMoveSeverity = 'minor' | 'moderate' | 'severe';

/** 阶段 */
export type DecisionPhase = 'layout' | 'middle' | 'endgame';

/** 棋手等级 */
export type GameLevel = 'pro' | 'high' | 'normal';

/** 决策选项 */
export interface IDecisionOption {
  position: string;           // SGF坐标，如 'pd'
  winrate: number;            // 该选点胜率（0-100）
  label: 'A' | 'B' | 'C' | 'D';
  variations?: string[];      // 后续变化（SGF着法序列）
  isPractical?: boolean;      // 是否是实战选点（恶手题中为恶手）
  /** 兼容旧页面字段：同 position */
  coord?: string | undefined;
  /** 兼容旧页面字段：同 label */
  letter?: 'A' | 'B' | 'C' | 'D' | undefined;
  /** 兼容旧页面字段：带颜色的变化图 */
  variation?: Array<{ color: 'B' | 'W'; coord: string }> | undefined;
}

/** 决策题 */
export interface IDecisionProblem {
  id: string;
  position: string | Array<{ color: 'B' | 'W'; coord: string }>; // 当前局面
  turn: 'B' | 'W';            // 行棋方
  options: IDecisionOption[]; // 4个选项
  correctIndex: number;       // 正确答案索引
  difficulty: DecisionDifficulty;
  phase: DecisionPhase;
  metadata: {
    moveNumber: number;
    playerBlack?: string | undefined;
    playerWhite?: string | undefined;
    blackRank?: string | undefined;
    whiteRank?: string | undefined;
    gameLevel: GameLevel;
    gameName?: string | undefined;
    event?: string | undefined;
    date?: string | undefined;
    result?: string | undefined;
    archiveId?: string | undefined;
    url?: string | undefined;
    gameId?: string | undefined;
  };
}

/** 答题结果 */
export interface IDecisionResult {
  problemId: string;
  selectedOption: number;
  isCorrect: boolean;
  timeSpent?: number;
  timestamp: Date;
}

/** 行棋序列（用于变化图） */
export type MoveSequence = Array<{ color: 'B' | 'W'; coord: string }>;

/** AI 对弈难度 */
export type Difficulty = DecisionDifficulty;
