/**
 * 排名计算器类型定义
 */

/** 对阵数据 */
export interface MatchData {
  /** 轮次 */
  bout: number;
  /** 黑方ID */
  p1Id: number;
  /** 黑方姓名 */
  p1Name: string;
  /** 黑方得分（胜=2, 负=0, 和=1） */
  p1Score: number;
  /** 白方ID */
  p2Id: number;
  /** 白方姓名 */
  p2Name: string;
  /** 白方得分（胜=2, 负=0, 和=1） */
  p2Score: number;
}

/** 选手排名 */
export interface PlayerRanking {
  /** 选手ID */
  id: number;
  /** 选手姓名 */
  name: string;
  /** 最终排名 */
  rank: number;
  /** 积分 */
  score: number;
  /** 对手分（SOS） */
  opponentScore: number;
  /** 累进分 */
  progressiveScore: number;
  /** 逆减序列（用于同分破同分） */
  reverseMinus: number[];
  /** 逆减显示（如 "3-12"） */
  reverseMinusDisplay: string;
  /** 胜局数 */
  wins: number;
  /** 负局数 */
  losses: number;
  /** 和局数 */
  draws: number;
  /** 对局记录 */
  games?: Array<{
    bout: number;
    opponentName: string;
    result: 'win' | 'lose' | 'draw' | 'bye' | 'bye_win';
    color: 'black' | 'white';
  }>;
}

/** 排名结果 */
export interface RankingResult {
  /** 排名列表 */
  rankings: PlayerRanking[];
  /** 总轮数 */
  totalRounds: number;
  /** 已完成轮数 */
  completedRounds: number;
}

/** 排名模式 */
export type RankingMode = 'default' | 'simple';

/** 内部选手数据（计算用） */
export interface InternalPlayer {
  id: number;
  name: string;
  score: number;
  opponentScore: number;
  progressiveScore: number;
  wins: number;
  losses: number;
  draws: number;
  opponents: number[];
  progressive: number[];
  roundOpponents: Array<{ bout: number; opponentId: number; opponentName: string }>;
  reverseMinus: number[];
  reverseMinusDisplay: string;
}