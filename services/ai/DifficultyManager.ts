/**
 * @fileoverview 难度管理器
 */

import type { Difficulty } from './types';

/**
 * 难度配置映射表
 */
const VISITS_MAP: Record<Difficulty, number> = {
  easy: 50,
  medium: 100,
  hard: 200,
};

/**
 * 难度管理器
 *
 * 管理难度等级与 AI visits 数的映射关系。
 */
export class DifficultyManager {
  private difficulty: Difficulty;

  /**
   * 创建难度管理器
   * @param difficulty - 初始难度等级
   */
  constructor(difficulty: Difficulty = 'medium') {
    this.difficulty = difficulty;
  }

  /**
   * 获取当前难度
   */
  getDifficulty(): Difficulty {
    return this.difficulty;
  }

  /**
   * 设置难度
   */
  setDifficulty(difficulty: Difficulty): void {
    this.difficulty = difficulty;
  }

  /**
   * 获取对应的 visits 数
   */
  getVisits(): number {
    return VISITS_MAP[this.difficulty];
  }

  /**
   * 获取所有难度选项
   */
  static getOptions(): Difficulty[] {
    return ['easy', 'medium', 'hard'];
  }

  /**
   * 获取难度映射表
   */
  static getVisitsMap(): Record<Difficulty, number> {
    return { ...VISITS_MAP };
  }
}
