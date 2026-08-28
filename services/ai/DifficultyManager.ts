/**
 * @fileoverview 难度管理器
 */

import type { Difficulty, DifficultyConfig, CustomDifficulty } from './types';

/**
 * 预设难度配置映射表
 */
const PRESET_CONFIGS: Record<Difficulty, DifficultyConfig> = {
  easy: { visits: 50, wideRootNoise: 0.2, nnRandomize: true, label: '简单' },
  medium: { visits: 100, wideRootNoise: 0.1, nnRandomize: false, label: '中等' },
  hard: { visits: 200, wideRootNoise: 0, nnRandomize: false, label: '困难' },
  custom: { visits: 100, wideRootNoise: 0.1, nnRandomize: false, label: '自定义' },
};

/**
 * 难度管理器
 *
 * 管理难度等级与 AI 参数的映射关系。
 */
export class DifficultyManager {
  private currentConfig: DifficultyConfig;
  private currentDifficulty: Difficulty;

  /**
   * 创建难度管理器
   * @param difficulty - 初始难度等级或自定义配置
   */
  constructor(difficulty: Difficulty | DifficultyConfig = 'medium') {
    if (typeof difficulty === 'string') {
      this.currentDifficulty = difficulty;
      this.currentConfig = { ...PRESET_CONFIGS[difficulty] };
    } else {
      this.currentDifficulty = 'custom';
      this.currentConfig = { ...difficulty };
    }
  }

  /**
   * 获取当前难度等级
   */
  getDifficulty(): Difficulty {
    return this.currentDifficulty;
  }

  /**
   * 设置难度等级
   */
  setDifficulty(difficulty: Difficulty): void {
    this.currentDifficulty = difficulty;
    this.currentConfig = { ...PRESET_CONFIGS[difficulty] };
  }

  /**
   * 设置自定义配置
   */
  setCustomConfig(config: DifficultyConfig): void {
    this.currentDifficulty = 'custom';
    this.currentConfig = {
      visits: config.visits,
      wideRootNoise: config.wideRootNoise ?? 0,
      nnRandomize: config.nnRandomize ?? false,
      label: config.label ?? '自定义',
    };
  }

  /**
   * 获取当前完整配置
   */
  getConfig(): DifficultyConfig {
    return { ...this.currentConfig };
  }

  /**
   * 获取搜索次数
   */
  getVisits(): number {
    return this.currentConfig.visits;
  }

  /**
   * 获取根节点随机性
   */
  getWideRootNoise(): number {
    return this.currentConfig.wideRootNoise ?? 0;
  }

  /**
   * 获取神经网络随机化标志
   */
  getNnRandomize(): boolean {
    return this.currentConfig.nnRandomize ?? false;
  }

  /**
   * 获取标签
   */
  getLabel(): string {
    return this.currentConfig.label ?? '自定义';
  }

  /**
   * 获取所有预设难度选项
   */
  static getPresetDifficulties(): Difficulty[] {
    return ['easy', 'medium', 'hard'];
  }

  /**
   * 获取预设配置
   */
  static getPresetConfig(difficulty: Difficulty): DifficultyConfig {
    return { ...PRESET_CONFIGS[difficulty] };
  }

  /**
   * 从自定义难度创建配置
   */
  static fromCustomDifficulty(custom: CustomDifficulty): DifficultyConfig {
    return {
      visits: custom.visits,
      wideRootNoise: custom.wideRootNoise,
      nnRandomize: custom.nnRandomize,
      label: custom.label,
    };
  }
}
