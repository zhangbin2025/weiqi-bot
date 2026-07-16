/**
 * @fileoverview RecorderService 类型定义
 */

import type { IGameState } from '../../domain/game';

/**
 * 草稿数据结构
 */
export interface IDraft {
  /** SGF 字符串 */
  readonly sgf: string;
  /** 游戏状态元数据 */
  readonly state: IGameState;
}

/**
 * 对局元数据
 */
export interface IGameMetadata {
  /** 对局名称 */
  readonly name?: string;
  /** 黑方名称 */
  readonly blackName?: string;
  /** 白方名称 */
  readonly whiteName?: string;
  /** 对局日期 */
  readonly date?: string;
  /** 结果 */
  readonly result?: string;
  /** 规则 */
  readonly rules?: string;
}

/**
 * 回调函数类型
 */
export type OnUpdateCallback = (state: IGameState) => void;
