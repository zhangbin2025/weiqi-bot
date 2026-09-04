/**
 * SGF 变化图类型定义
 * @module domain/sgf/SGFVariationTypes
 */

import type { PlayerColor } from '../primitives';

/**
 * 变化图着法
 */
export interface VariationMove {
  /** 着法颜色 */
  color: 'B' | 'W';
  /** 着法坐标 */
  coord: string;
}

/**
 * 变化图
 */
export interface ISGFVariation {
  /** 变化图名称 */
  name: string;
  /** 着法序列 */
  moves: VariationMove[];
  /** 注释（可能含胜率） */
  comment?: string;
}

/**
 * 胜率点
 */
export interface WinratePoint {
  /** 手数 */
  moveNumber: number;
  /** 颜色 */
  color: PlayerColor;
  /** 胜率（0-100） */
  winrate: number;
  /** 原始注释 */
  comment?: string;
  /** 黑方胜率（0-1，KataGo Archive 格式） */
  blackWr?: number;
  /** 白方胜率（0-1，KataGo Archive 格式） */
  whiteWr?: number;
  /** 分差（KataGo Archive 格式） */
  scoreMean?: number;
  /** 访问量（KataGo Archive 格式） */
  visits?: number;
}
