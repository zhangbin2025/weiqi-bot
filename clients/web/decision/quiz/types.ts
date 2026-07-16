/**
 * 答题类型定义
 * @description 定义答题页面的核心类型
 */

/**
 * 着法
 */
export type Move = { color: 'B' | 'W'; coord: string };

/**
 * 题目选项
 */
export type QuizOption = {
  coord: string;
  letter: string;
  winrate?: number;
  variation: Move[];
  isPractical?: boolean;
};

/**
 * 题目
 */
export type QuizProblem = {
  id: string;
  position: Move[];
  turn: 'B' | 'W';
  options: QuizOption[];
  correctIndex: number;
  phase: 'layout' | 'middle' | 'endgame';
  metadata: Record<string, any>;
  __originalIndex?: number;
};

/**
 * 状态常量
 */
export const STATE_MAIN = 'main';
export const STATE_TRYPLAY = 'tryplay';
export const STATE_VARIATION = 'variation';
