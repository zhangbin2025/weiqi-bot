/**
 * @fileoverview 默认模型配置服务
 * @description 统一管理默认模型配置，避免硬编码
 */

import type { ModelConfig } from './types';

/**
 * 默认模型配置
 * @description 在这里统一配置默认模型ID，所有地方都从这里读取
 */
const DEFAULT_MODEL_CONFIG = {
  // 默认模型 ID
  id: 'g170-b10c128',
  
  // 默认模型名称
  name: 'KataGo b10c128',
  
  // 默认模型文件名
  filename: 'g170-b10c128.bin.gz',
  
  // 默认模型大小
  size: '10.6MB',
  
  // 默认模型 URL 路径（相对于 web root）
  url: 'models/g170-b10c128.bin.gz',
} as const;

/**
 * 默认模型服务
 * 
 * 提供统一的默认模型配置接口，避免在代码中硬编码模型 ID
 */
export class DefaultModelService {
  /**
   * 获取默认模型 ID
   * @returns 默认模型 ID
   */
  static getDefaultModelId(): string {
    return DEFAULT_MODEL_CONFIG.id;
  }

  /**
   * 获取默认模型名称
   * @returns 默认模型名称
   */
  static getDefaultModelName(): string {
    return DEFAULT_MODEL_CONFIG.name;
  }

  /**
   * 获取默认模型文件名
   * @returns 默认模型文件名
   */
  static getDefaultModelFilename(): string {
    return DEFAULT_MODEL_CONFIG.filename;
  }

  /**
   * 获取默认模型大小
   * @returns 默认模型大小（人类可读格式）
   */
  static getDefaultModelSize(): string {
    return DEFAULT_MODEL_CONFIG.size;
  }

  /**
   * 获取默认模型 URL 路径
   * @returns 默认模型 URL 路径（相对于 web root）
   */
  static getDefaultModelUrl(): string {
    return DEFAULT_MODEL_CONFIG.url;
  }

  /**
   * 获取默认模型完整 URL
   * @param webRoot Web 根目录路径
   * @returns 默认模型完整 URL
   */
  static getDefaultModelFullUrl(webRoot: string): string {
    return webRoot + DEFAULT_MODEL_CONFIG.url;
  }

  /**
   * 获取默认模型卡片信息
   * @returns 默认模型卡片信息（用于 UI 显示）
   */
  static getDefaultModelCard(): { id: string; name: string; size: string } {
    return {
      id: DEFAULT_MODEL_CONFIG.id,
      name: DEFAULT_MODEL_CONFIG.name,
      size: DEFAULT_MODEL_CONFIG.size,
    };
  }

  /**
   * 从模型列表中找到默认模型
   * @param models 模型列表
   * @returns 默认模型配置，如果没有找到则返回第一个模型
   */
  static findDefaultModel(models: ModelConfig[]): ModelConfig | undefined {
    // 优先找 isDefault: true 的模型
    const defaultModel = models.find(m => m.isDefault === true);
    if (defaultModel) {
      return defaultModel;
    }
    
    // 如果没有找到，返回第一个模型
    return models[0];
  }

  /**
   * 从模型列表中找到默认模型 ID
   * @param models 模型列表
   * @returns 默认模型 ID
   */
  static findDefaultModelId(models: ModelConfig[]): string {
    const model = this.findDefaultModel(models);
    return model?.id ?? this.getDefaultModelId();
  }
}
