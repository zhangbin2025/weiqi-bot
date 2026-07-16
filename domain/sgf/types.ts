/**
 * SGF 解析器核心类型定义
 * @module domain/sgf/types
 */

import type { PlayerColor } from '../primitives';
import type { MoveOrPass } from '../move';

/**
 * SGF 属性值（单个值或数组）
 */
export type SGFPropValue = string | string[];

/**
 * SGF 属性字典
 */
export interface SGFProperties {
  [name: string]: SGFPropValue;
}

/**
 * SGF 节点（树状结构）
 */
export interface ISGFNode {
  /** 属性字典 */
  properties: SGFProperties;
  /** 是否根节点 */
  isRoot: boolean;
  /** 手数（根节点为0） */
  moveNumber: number;
  /** 着法颜色（B/W），非着法节点为 null */
  color: 'B' | 'W' | null;
  /** 着法坐标（如 'pd'），非着法节点为 null */
  coord: string | null;
  /** 子节点（分支） */
  children: ISGFNode[];
}

/**
 * 让子位置
 */
export interface HandicapStone {
  x: number;
  y: number;
  color: 'B' | 'W';
}

/**
 * 棋局信息（完整版，对齐 Python）
 */
export interface ISGFGameInfoFull {
  boardSize: number;
  black: string;
  white: string;
  blackRank?: string;
  whiteRank?: string;
  event?: string;
  gameName: string;
  date?: string;
  result?: string;
  komi: string;
  handicap: number;
  handicapStones: HandicapStone[];
}

/**
 * 解析统计信息
 */
export interface ISGFStats {
  totalNodes: number;
  moveNodes: number;
  maxDepth: number;
  branchCount: number;
}

/**
 * SGF 解析结果（完整版）
 */
export interface ISGFParseResult {
  gameInfo: ISGFGameInfoFull;
  tree: ISGFNode;
  stats: ISGFStats;
  moves: Array<{ color: 'B' | 'W'; coord: string }>;
  variations: Record<number, Array<{ name: string; moves: Array<{ color: 'B' | 'W'; coord: string }>; comment?: string }>>;
  winrates: Array<{ moveNumber: number; color: PlayerColor; winrate: number; comment?: string }>;
  errors: string[];
}

/**
 * SGF 解析器接口
 */
export interface ISGFParser {
  parse(sgf: string): ISGFParseResult;
  parseFile(filepath: string): ISGFParseResult;
}

// ==================== 旧版接口（向后兼容） ====================

/**
 * SGF 属性接口（旧版）
 */
export interface ISGFProperty {
  readonly name: string;
  readonly value: string;
}

/**
 * SGF 节点接口（旧版）
 */
export interface ISGFNodeLegacy {
  readonly properties: ISGFProperty[];
  readonly children?: ISGFNodeLegacy[];
}

/**
 * SGF 游戏信息接口（旧版，被 SGFWriter 使用）
 */
export interface ISGFGameInfo {
  readonly size: number;
  readonly blackName: string;
  readonly whiteName: string;
  readonly komi: number;
  readonly result?: string | undefined;
  readonly date?: string | undefined;
  readonly handicap?: number | undefined;
  readonly handicapStones?: readonly { x: number; y: number; color: 'B' | 'W' }[] | undefined;
  readonly rules?: string | undefined;
}

/**
 * SGF 解析结果接口（旧版）
 */
export interface ISGFParseResultLegacy {
  readonly info: ISGFGameInfo;
  readonly moves: MoveOrPass[];
  readonly handicapStones: { x: number; y: number; color: PlayerColor }[];
  readonly tree: ISGFNodeLegacy;
}

// 重导出变化图相关类型
export type { VariationMove, ISGFVariation, WinratePoint } from './SGFVariationTypes';
