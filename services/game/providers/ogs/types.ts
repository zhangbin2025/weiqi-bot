/**
 * @fileoverview OGS 类型定义
 */

/**
 * OGS API 响应：游戏数据
 */
export interface OgsGameResponse {
  /** 游戏 ID */
  id: number;
  /** 游戏数据 */
  gamedata: OgsGameData;
  /** 玩家信息 */
  players: {
    black: OgsPlayer;
    white: OgsPlayer;
  };
  /** 开始时间（ISO 字符串） */
  started?: string;
  /** 结束时间（ISO 字符串） */
  ended?: string;
  /** 结果描述 */
  outcome?: string;
  /** 黑方是否输 */
  black_lost?: boolean;
  /** 白方是否输 */
  white_lost?: boolean;
}

/**
 * OGS 游戏数据
 */
export interface OgsGameData {
  /** 棋盘宽度 */
  width: number;
  /** 棋盘高度 */
  height: number;
  /** 贴目 */
  komi: number;
  /** 让子数 */
  handicap: number;
  /** 规则 */
  rules: string;
  /** 着法列表 [[x, y], ...]，(-1, -1) 表示 pass */
  moves: number[][];
  /** 初始棋子状态（让子棋专用）
   * 格式: { black: "pddp", white: "" }
   * black/white 值为连续的 SGF 坐标对（每2个字符表示一个位置）
   */
  initial_state?: {
    black?: string;
    white?: string;
  };
  /** 先手方 ('black' | 'white')，让子棋时为 'white' */
  initial_player?: 'black' | 'white';
  /** 是否自由让子位置 */
  free_handicap_placement?: boolean;
}

/**
 * OGS 玩家信息
 */
export interface OgsPlayer {
  /** 用户名 */
  username?: string;
  /** 等级分 */
  ranking?: number;
  /** 段位（字符串形式） */
  rank?: number;
}

/**
 * OGS 游戏元数据
 */
export interface OgsMetadata {
  /** 游戏 ID */
  gameId: string;
  /** 黑方名字 */
  blackName: string;
  /** 白方名字 */
  whiteName: string;
  /** 黑方段位 */
  blackRank: string;
  /** 白方段位 */
  whiteRank: string;
  /** 棋盘宽度 */
  width: number;
  /** 棋盘高度 */
  height: number;
  /** 贴目 */
  komi: number;
  /** 让子数 */
  handicap: number;
  /** 规则 */
  rules: string;
  /** 对局日期 */
  date: string;
  /** 结果 */
  result: string;
  /** 手数 */
  movesCount: number;
}

// ============================================================================
// AI Review 类型定义
// ============================================================================

/**
 * AI Review 元数据（REST API 返回）
 */
export interface OgsAiReviewMeta {
  id: number;
  uuid: string;
  type: string;
  game_id: number;
  engine: string;
  engine_version?: string;
  network?: string;
  network_size?: string;
  playouts?: number;
  visits?: number;
  strength?: number;
  date: string;
  win_rate: number;
  moves: Record<string, never>;
  cheat_detection?: boolean;
}

/**
 * AI Review 详细数据（WebSocket 推送）
 */
export interface OgsAiReviewData {
  metadata?: OgsAiReviewMetadata;
  [key: string]: unknown;
}

/**
 * AI Review metadata（WebSocket 推送的完整版本）
 */
export interface OgsAiReviewMetadata {
  id: string;
  uuid: string;
  type: string;
  engine: string;
  engine_version: string;
  network: string;
  network_size: string;
  strength: number;
  date: number;
  win_rate: number;
  /** 每手胜率数组，索引 = 手数（0-based） */
  win_rates: number[];
  /** 每手目差数组，索引 = 手数（0-based） */
  scores: number[];
  moves: Record<string, unknown>;
  game_state?: unknown;
  scores_history?: unknown;
}

/**
 * AI Review 单手详细数据（move-N 的值）
 */
export interface OgsAiReviewMove {
  move_number: number;
  move: { x: number; y: number };
  win_rate: number;
  score: number;
  branches: OgsAiReviewBranch[];
}

/**
 * AI Review 选点分支
 */
export interface OgsAiReviewBranch {
  moves: { x: number; y: number }[];
  win_rate?: number;
  /** 旧版字段名 */
  score?: number;
  /** 新版（WebSocket）字段名 */
  score_mean?: number;
  visits?: number;
  score_stdev?: number;
}

/**
 * 整合后的 AI Review 数据（传给 SGF 生成器）
 */
export interface OgsAiReviewSummary {
  /** 引擎名称 */
  engine: string;
  /** 网络名称 */
  network: string;
  /** 最终胜率 */
  finalWinRate: number;
  /** 每手胜率数组 */
  winRates: number[];
  /** 每手目差数组 */
  scores: number[];
  /** 关键手详细数据（含选点分支） */
  moveDetails: Map<number, OgsAiReviewMove>;
}

// ============================================================================
// Player 类型定义
// ============================================================================

/**
 * OGS 玩家信息（搜索结果）
 */
export interface OgsPlayerInfo {
  /** 玩家 ID */
  id: number;
  /** 用户名 */
  username: string;
  /** 国家代码 */
  country?: string;
  /** 段位值（OGS ranking: 0-30 = 30k-1k, 30+ = 1d, ...） */
  ranking?: number;
  /** 是否职业 */
  professional?: boolean;
}

/**
 * OGS 玩家对局列表项（REST API 返回）
 */
export interface OgsPlayerGame {
  /** 对局 ID */
  id: number;
  /** 对局名称 */
  name?: string;
  /** 玩家信息（包含完整对象） */
  players: {
    black: { id: number; username: string; ranking?: number };
    white: { id: number; username: string; ranking?: number };
  };
  /** 黑方玩家 ID（整数） */
  black: number;
  /** 白方玩家 ID（整数） */
  white: number;
  /** 棋盘宽度 */
  width: number;
  /** 棋盘高度 */
  height: number;
  /** 让子数 */
  handicap: number;
  /** 贴目 */
  komi: string;
  /** 是否排位赛 */
  ranked: boolean;
  /** 结果描述 */
  outcome?: string;
  /** 黑方是否输 */
  black_lost?: boolean;
  /** 白方是否输 */
  white_lost?: boolean;
  /** 开始时间 */
  started?: string;
  /** 结束时间 */
  ended?: string;
}

// ============================================================================
// Puzzle 类型定义
// ============================================================================

/**
 * OGS Puzzle 分支节点（move_tree 中的每个节点）
 */
export interface OgsPuzzleBranch {
  /** X 坐标 (0-based, -1 = 根节点/pass) */
  x: number;
  /** Y 坐标 (0-based, -1 = 根节点/pass) */
  y: number;
  /** 是否正解 */
  correct_answer?: boolean;
  /** 是否失败 */
  wrong_answer?: boolean;
  /** 注释文本 */
  text?: string;
  /** 子分支 */
  branches?: OgsPuzzleBranch[];
  /** 标记 */
  marks?: Array<{
    x: number;
    y: number;
    marks: Record<string, unknown>;
  }>;
}

/**
 * OGS Puzzle move_tree 根节点
 */
export interface OgsPuzzleMoveTree {
  /** X 坐标 (-1 = 根节点) */
  x: number;
  /** Y 坐标 (-1 = 根节点) */
  y: number;
  /** 分支列表 */
  branches?: OgsPuzzleBranch[];
  /** 根节点标记 */
  marks?: Array<{
    x: number;
    y: number;
    marks: Record<string, unknown>;
  }>;
}

/**
 * OGS Puzzle 内部数据（puzzle 字段）
 */
export interface OgsPuzzleData {
  /** 题目名称 */
  name: string;
  /** 难度等级 */
  puzzle_rank: string;
  /** move_tree 分支树 */
  move_tree: OgsPuzzleMoveTree;
  /** 先手方 */
  initial_player: 'black' | 'white';
  /** 棋盘宽度 */
  width: number;
  /** 棋盘高度 */
  height: number;
  /** 模式 */
  mode: string;
  /** 题目类型 */
  puzzle_type: string;
  /** 题目集合 ID */
  puzzle_collection: string;
  /** 初始状态 */
  initial_state?: {
    white?: string;
    black?: string;
  };
  /** 题目描述 */
  puzzle_description?: string;
  /** 对手移动模式 */
  puzzle_opponent_move_mode?: 'automatic' | 'manual';
  /** 玩家移动模式 */
  puzzle_player_move_mode?: 'free' | 'fixed';
}

/**
 * OGS Puzzle 详情（REST API 返回）
 */
export interface OgsPuzzleDetail {
  /** 题目 ID */
  id: number;
  /** 排序 */
  order: number;
  /** 所有者 */
  owner?: {
    id: number;
    username: string;
    country?: string;
    ranking?: number;
  };
  /** 题目名称 */
  name: string;
  /** 创建时间 */
  created: string;
  /** 修改时间 */
  modified: string;
  /** 题目内部数据 */
  puzzle: OgsPuzzleData;
  /** 是否私有 */
  private: boolean;
  /** 棋盘宽度 */
  width: number;
  /** 棋盘高度 */
  height: number;
  /** 题目类型 */
  type: string;
  /** 是否有解答 */
  has_solution: boolean;
  /** 评分 */
  rating?: number;
  /** 评分人数 */
  rating_count?: number;
  /** 难度等级 */
  rank: number;
  /** 浏览次数 */
  view_count?: number;
  /** 解答次数 */
  solved_count?: number;
  /** 尝试次数 */
  attempt_count?: number;
  /** 所属集合 */
  collection?: {
    id: number;
    name: string;
    puzzle_count?: number;
    min_rank?: number;
    max_rank?: number;
  };
}

/**
 * OGS Puzzle 列表项
 */
export interface OgsPuzzleListItem {
  id: number;
  name: string;
  created: string;
  modified: string;
}

/**
 * OGS Puzzle 列表响应
 */
export interface OgsPuzzleListResponse {
  count: number;
  next: string | null;
  results: OgsPuzzleListItem[];
}
