/**
 * 人机对弈配置加载器
 * @module services/play/hm/HMPlayConfigLoader
 */

import type { IConfigProvider } from '../../../infrastructure/config/interfaces/IConfigProvider';
import type { IHMPlayServiceConfig } from '../../../infrastructure/config/schemas/HMPlayConfigSchema';
import type { Difficulty } from '../../ai/types';

/**
 * 配置加载器
 * 负责加载和缓存服务配置
 */
export class HMPlayConfigLoader {
  private configProvider: IConfigProvider | null = null;
  private cachedConfig: IHMPlayServiceConfig | null = null;

  constructor(configProvider?: IConfigProvider) {
    this.configProvider = configProvider ?? null;
  }

  /**
   * 获取服务配置（带缓存）
   */
  async getConfig(): Promise<IHMPlayServiceConfig> {
    if (!this.cachedConfig) {
      this.cachedConfig = this.configProvider
        ? await this.configProvider.getModuleConfig<IHMPlayServiceConfig>('hmplay')
        : this.getDefaultConfig();
    }
    return this.cachedConfig;
  }

  /**
   * 获取默认配置
   */
  private getDefaultConfig(): IHMPlayServiceConfig {
    return {
      defaultDifficulty: 'medium',
      defaultModelId: 'katago-small',
      defaultVisits: { easy: 50, medium: 100, hard: 200 },
      defaultNoUndo: false,
    };
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cachedConfig = null;
  }

  /**
   * 获取指定难度的访问次数
   */
  getVisitsForDifficulty(difficulty: Difficulty, config: IHMPlayServiceConfig): number {
    return config.defaultVisits[difficulty] ?? 100;
  }
}
