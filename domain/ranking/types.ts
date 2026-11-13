/**
 * 排名模块类型定义
 * @module domain/ranking/types
 *
 * 唯一原始数据源是「对阵表」(MatchData[])。
 * 内置实现与插件实现都只吃这份对阵，产出同一张 RankingTable：
 * 积分、对手分、累进分等一切中间量都由实现自行计算，宿主不代算、不预置字段。
 */

/** 对阵数据（唯一原始来源；与 services/event 的 Match 结构兼容） */
export interface MatchData {
  /** 轮次 */
  bout: number;
  /** 台号（可选，PDF 与 API 对阵表都会带，排名计算用不到但保留原始信息） */
  table?: number;
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

/** 排名实现的输入：最原始的对阵表，别无其它 */
export interface RankingInput {
  matches: MatchData[];
}

/** 排名表的一列。key 为英文标识符，label 必须是纯汉字列名 */
export interface RankingColumn {
  key: string;
  label: string;
}

/**
 * 自定义数据列的单元格值：
 * - 有限数值，或
 * - 元素全部为有限数值的数组（例如逐轮逆减 [3, 12] 渲染为 "3-12"）
 *
 * 只允许数值、不允许字符串/HTML/对象，插件产出无需 HTML 转义。
 * 注意：数值约束只作用于 cells（自定义数据列）。姓名 name 与名次 rank 是
 * 宿主保留的只读结构列，不进 cells、不受此约束。
 */
export type RankingCellValue = number | number[];

/** 排名表的一行 */
export interface RankingRow {
  /** 原始对阵里的选手 id（宿主保留结构字段，只读） */
  id: number;
  /** 原始姓名（宿主保留结构字段，只读；渲染由宿主转义，插件不可改） */
  name: string;
  /** 名次（宿主保留结构字段；有限数值） */
  rank: number;
  /** 自定义数据列，值为数值或数值数组；'rank'/'name' 不进这里 */
  cells: Record<string, RankingCellValue>;
}

/** 排名实现的产出（不含轮次元信息，那些由宿主从同一份对阵派生） */
export interface RankingOutput {
  columns: RankingColumn[];
  rows: RankingRow[];
}

/** 排名表：内置与插件共用同一份产出结构 */
export interface RankingTable extends RankingOutput {
  totalRounds: number;
  completedRounds: number;
}

/** 内置实现的排序口径（插件不受此约束，规则由插件自己写） */
export type RankingMode = 'default' | 'simple' | 'directWin';

/** 对手弹窗的一局（从原始对阵派生，不属于排名表字段） */
export interface PlayerGame {
  bout: number;
  opponentName: string;
  result: 'win' | 'lose' | 'draw' | 'bye' | 'bye_win';
  color: 'black' | 'white';
}

/** 内置算法内部状态 */
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
  /** 破同分时用于展示的逐轮逆减数值数组（旧版 "3-12" 字符串的数值化形态） */
  reverseMinusValue: number[];
  /** 直胜结果：opponentId → 1(胜)/-1(负)/0.5(和) */
  directWinResults: Map<number, number>;
}
