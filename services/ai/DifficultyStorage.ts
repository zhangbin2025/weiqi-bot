/**
 * @fileoverview 难度配置本地存储
 */

import type { CustomDifficulty } from './types';

const STORAGE_KEY = 'weiqi-custom-difficulties';

/**
 * 难度配置存储服务
 */
export class DifficultyStorage {
  /**
   * 加载所有自定义难度配置
   */
  async load(): Promise<CustomDifficulty[]> {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      
      const configs = JSON.parse(stored) as CustomDifficulty[];
      // 按创建时间倒序排序
      return configs.sort((a, b) => b.createdAt - a.createdAt);
    } catch (error) {
      console.error('[DifficultyStorage] 加载失败:', error);
      return [];
    }
  }

  /**
   * 保存自定义难度配置
   */
  async save(config: CustomDifficulty): Promise<void> {
    try {
      const configs = await this.load();
      
      // 检查是否已存在（更新）
      const existingIndex = configs.findIndex(c => c.id === config.id);
      if (existingIndex >= 0) {
        configs[existingIndex] = config;
      } else {
        configs.unshift(config); // 新配置放前面
      }
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
    } catch (error) {
      console.error('[DifficultyStorage] 保存失败:', error);
      throw error;
    }
  }

  /**
   * 删除自定义难度配置
   */
  async delete(id: string): Promise<void> {
    try {
      const configs = await this.load();
      const filtered = configs.filter(c => c.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    } catch (error) {
      console.error('[DifficultyStorage] 删除失败:', error);
      throw error;
    }
  }

  /**
   * 更新自定义难度配置
   */
  async update(id: string, updates: Partial<CustomDifficulty>): Promise<void> {
    try {
      const configs = await this.load();
      const index = configs.findIndex(c => c.id === id);
      
      if (index >= 0) {
        configs[index] = { ...configs[index]!, ...updates };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
      }
    } catch (error) {
      console.error('[DifficultyStorage] 更新失败:', error);
      throw error;
    }
  }

  /**
   * 生成唯一 ID
   */
  static generateId(): string {
    return `difficulty_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
