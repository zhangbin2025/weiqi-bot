/**
 * 定式练习配置模式
 */

export interface IJosekiQuizConfig {
  /** 默认题目数 */
  defaultQuizCount: number;
  /** 默认难度 */
  defaultDifficulty: 'easy' | 'medium' | 'hard';
  /** 默认阶段 */
  defaultPhase: 'layout' | 'middle' | 'endgame';
  /** 超时时间（毫秒） */
  timeout: number;
}

export const JosekiQuizConfigSchema: IJosekiQuizConfig = {
  defaultQuizCount: 10,
  defaultDifficulty: 'medium',
  defaultPhase: 'middle',
  timeout: 30000,
};
