/**
 * @fileoverview AI 引擎接口定义
 * @description 跨平台 AI 引擎接口，供各平台适配器实现
 */

import type {
  BoardState,
  Player,
  Move,
  GameRules,
  RegionOfInterest,
  AnalysisResult,
} from '@weiqi/worker';

/**
 * AI 引擎初始化选项
 */
export interface AIEngineInitOptions {
  /** 模型 URL */
  modelUrl: string;
  /** 加载进度回调 */
  onProgress?: ((loaded: number, total: number, progress: number) => void) | undefined;
  /** 初始化进度回调（KataGo tuning 等） */
  onInitProgress?: ((info: { stage: string; message: string; current?: number; total?: number }) => void) | undefined;
}

/**
 * 分析选项
 */
export interface AnalyzeOptions {
  /** 分析组 */
  analysisGroup?: 'interactive' | 'background' | undefined;
  /** 位置 ID */
  positionId?: string | undefined;
  /** 父位置 ID */
  parentPositionId?: string | undefined;
  /** 模型 URL */
  modelUrl: string;
  /** 当前棋盘 */
  board: BoardState;
  /** 前一棋盘 */
  previousBoard?: BoardState | undefined;
  /** 前前棋盘 */
  previousPreviousBoard?: BoardState | undefined;
  /** 当前玩家 */
  currentPlayer: Player;
  /** 历史着法 */
  moveHistory: Move[];
  /** 初始棋子（让子等） */
  initialStones?: Array<{ player: Player; x: number; y: number }>;
  /** 贴目 */
  komi: number;
  /** 规则 */
  rules?: GameRules | undefined;
  /** 感兴趣区域 */
  regionOfInterest?: RegionOfInterest | null | undefined;
  /** 返回前 K 个候选着法 */
  topK?: number | undefined;
  /** 分析 PV 长度 */
  analysisPvLen?: number | undefined;
  /** 是否包含着法所有权 */
  includeMovesOwnership?: boolean | undefined;
  /** 宽根噪声 */
  wideRootNoise?: number | undefined;
  /** 神经网络随机化 */
  nnRandomize?: boolean | undefined;
  /** 保守 Pass */
  conservativePass?: boolean | undefined;
  /** 访问次数 */
  visits?: number | undefined;
  /** 最大时间（毫秒） */
  maxTimeMs?: number | undefined;
  /** 批大小 */
  batchSize?: number | undefined;
  /** 最大子节点数 */
  maxChildren?: number | undefined;
  /** 搜索期间报告间隔（毫秒） */
  reportDuringSearchEveryMs?: number | undefined;
  /** 所有权刷新间隔（毫秒） */
  ownershipRefreshIntervalMs?: number | undefined;
  /** 是否重用树 */
  reuseTree?: boolean | undefined;
  /** 所有权模式 */
  ownershipMode?: 'none' | 'root' | 'tree' | undefined;
  /** 进度回调 */
  onProgress?: ((analysis: any) => void) | undefined;
}

/**
 * 评估选项
 */
export interface EvaluateOptions {
  /** 模型 URL */
  modelUrl: string;
  /** 当前棋盘 */
  board: BoardState;
  /** 前一棋盘 */
  previousBoard?: BoardState | undefined;
  /** 前前棋盘 */
  previousPreviousBoard?: BoardState | undefined;
  /** 当前玩家 */
  currentPlayer: Player;
  /** 历史着法 */
  moveHistory: Move[];
  /** 贴目 */
  komi: number;
  /** 规则 */
  rules?: GameRules | undefined;
  /** 保守 Pass */
  conservativePass?: boolean | undefined;
}

/**
 * 批量评估选项
 */
export interface EvaluateBatchOptions {
  /** 模型 URL */
  modelUrl: string;
  /** 位置列表 */
  positions: Array<{
    board: BoardState;
    previousBoard?: BoardState | undefined;
    previousPreviousBoard?: BoardState | undefined;
    currentPlayer: Player;
    moveHistory: Move[];
    komi: number;
  }>;
  /** 规则 */
  rules?: GameRules | undefined;
  /** 保守 Pass */
  conservativePass?: boolean | undefined;
}

/**
 * 引擎信息
 */
export interface EngineInfo {
  /** 后端名称 */
  backend: string | null;
  /** 模型名称 */
  modelName: string | null;
}

/**
 * 整盘分析选项 — 对应 KataGo analysis 协议
 * 
 * 与 AnalyzeOptions 不同，这里直接使用着法列表，
 * 不需要预先重建棋盘状态，由 KataGo 原生引擎内部处理。
 */
export interface AnalyzeGameOptions {
  /** 着法列表 */
  moves: Array<{ player: 'black' | 'white'; x: number; y: number }>;
  /** 初始棋子（让子等） */
  initialStones?: Array<{ player: 'black' | 'white'; x: number; y: number }>;
  /** 贴目 */
  komi: number;
  /** 规则 */
  rules?: 'chinese' | 'japanese' | 'korean' | 'tromp-taylor' | 'aga';
  /** 棋盘宽度 */
  boardXSize?: number;
  /** 棋盘高度 */
  boardYSize?: number;
  /** 要分析的回合，undefined = 只分析最后一手 */
  analyzeTurns?: number[];
  /** 最大访问数 */
  maxVisits?: number;
  /** 最大搜索时间（秒） */
  maxTime?: number;
  /** PV 长度 */
  analysisPVLen?: number;
  /** 包含领地归属 */
  includeOwnership?: boolean;
  /** 包含每手领地归属 */
  includeMovesOwnership?: boolean;
  /** 搜索中间报告间隔（秒） */
  reportDuringSearchEvery?: number;
  /** 优先级 */
  priority?: number;
  /** 宽根噪声 */
  wideRootNoise?: number;
  /** 结果收集进度回调 */
  onResultProgress?: (current: number, total: number) => void;
  /** 覆盖设置 */
  overrideSettings?: Record<string, unknown>;
}

/**
 * 整盘分析的单回合结果 — 映射 KataGo 原生响应
 */
export interface GameTurnAnalysis {
  /** 回合号（0=初始局面） */
  turnNumber: number;
  /** 根节点黑方胜率 */
  rootWinRate: number;
  /** 根节点黑方目差 */
  rootScoreLead: number;
  /** 根节点访问数 */
  rootVisits: number;
  /** 候选着法 */
  moveInfos: Array<{
    move: string;
    winrate: number;
    scoreLead: number;
    scoreMean: number;
    scoreStdev: number;
    visits: number;
    prior: number;
    order: number;
    lcb: number;
    utility: number;
    pv: string[];
    pvVisits?: number[];
  }>;
  /** 领地归属 (361 float, +1=黑, -1=白) */
  ownership?: number[];
}

/**
 * AI 引擎接口
 * @description 跨平台 AI 引擎接口，支持初始化、分析、评估等操作
 */
export interface IAIEngine {
  /**
   * 初始化引擎
   * @param options 初始化选项
   */
  init(options: AIEngineInitOptions): Promise<void>;

  /**
   * 分析棋局（单局面）
   * @param options 分析选项
   * @returns 分析结果
   */
  analyze(options: AnalyzeOptions): Promise<AnalysisResult>;

  /**
   * 评估棋局
   * @param options 评估选项
   * @returns 评估结果
   */
  evaluate(options: EvaluateOptions): Promise<any>;

  /**
   * 批量评估棋局
   * @param options 批量评估选项
   * @returns 评估结果数组
   */
  evaluateBatch(options: EvaluateBatchOptions): Promise<any[]>;

  /**
   * 整盘批量分析
   *
   * 一次请求分析整盘棋的所有（或指定）回合。
   * App 端走原生进程，KataGo 内部批量 MCTS + 交叉批次，性能最优。
   * Web 端逐手串行 fallback。
   *
   * @param options 整盘分析选项
   * @returns 每个回合的分析结果
   */
  analyzeGame?(options: AnalyzeGameOptions): Promise<GameTurnAnalysis[]>;

  /**
   * 获取引擎信息
   * @returns 引擎信息
   */
  getEngineInfo(): EngineInfo;
}
