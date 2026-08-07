/**
 * @fileoverview 模型管理服务接口
 * @description 统一的模型管理服务接口，负责模型选择、切换和用户偏好管理
 */

import type { ModelConfig } from './types';
import type { DownloadProgressCallback } from './types';

/**
 * 模型管理服务接口
 * 
 * 职责：
 * - 管理当前选中的模型（单例）
 * - 协调 ModelService（配置）和 AIController（引擎）
 * - 保存/加载用户偏好
 */
export interface IModelManagementService {
  /**
   * 获取模型列表
   */
  getModels(): Promise<ModelConfig[]>;
  
  /**
   * 切换模型（全局单例）
   * 
   * @param modelId - 模型 ID
   * @param modelUrl - 模型 URL（可选，用于外部模型）
   * @param onProgress - 下载进度回调
   * @param onInitProgress - 初始化进度回调（KataGo tuning）
   */
  switchModel(
    modelId: string,
    modelUrl?: string,
    onProgress?: DownloadProgressCallback,
    onInitProgress?: (info: { stage: string; message: string; current?: number; total?: number }) => void
  ): Promise<void>;
  
  /**
   * 获取当前使用的模型 ID
   */
  getCurrentModel(): string | null;
  
  /**
   * 获取当前使用的模型文件名
   * @description 从 URL 中提取文件名，用于区分不同的模型
   */
  getCurrentModelFileName(): string | null;
  
  /**
   * 保存用户偏好（选择的模型）
   */
  savePreference(modelId: string, customModelUrl?: string): Promise<void>;
  
  /**
   * 加载用户偏好
   */
  loadPreference(): Promise<string | null>;

  /**
   * 加载模型文件名
   * @description 从偏好中加载文件名，用于区分不同模型
   */
  loadModelFileName(): Promise<string | null>;

  /**
   * 加载自定义模型的 URL
   */
  loadCustomModelUrl(): Promise<string | null>;
}
