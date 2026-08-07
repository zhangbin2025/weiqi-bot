/**
 * @fileoverview AI自对弈常量定义
 */

/** 游戏状态类型 */
export type MMGameState = 'idle' | 'loading' | 'running' | 'paused' | 'ended';

/** 游戏结束结果 */
export interface MMGameEndResult {
  winner: 'black' | 'white';
  margin: number;
  sgfResult: string;
  moveCount: number;
}

/** 对弈速度文本映射 */
export const MM_SPEED_TEXT: Record<string, string> = {
  instant: '极速',
  fast: '快速',
  normal: '正常',
  slow: '慢速'
};
