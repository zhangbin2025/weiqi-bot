/**
 * @fileoverview 模型管理服务实现
 * @description 统一的模型管理服务，负责模型选择、切换和用户偏好管理
 */

import type { IModelManagementService } from './IModelManagementService';
import type { ModelConfig, DownloadProgressCallback } from './types';
import type { ModelService } from './ModelService';
import type { IAIController } from '../ai/IAIController';
import type { IKeyValueStorage } from '../../infrastructure/storage/interfaces/IKeyValueStorage';

/**
 * 模型管理服务
 * 
 * 职责：
 * - 管理当前选中的模型（单例）
 * - 协调 ModelService（配置）和 AIController（引擎）
 * - 保存/加载用户偏好
 */
export class ModelManagementService implements IModelManagementService {
  private currentModelId: string | null = null;
  private currentModelFileName: string | null = null;

  /**
   * 创建模型管理服务
   * 
   * @param modelService - 模型配置服务
   * @param aiController - AI 控制器
   * @param preferenceStorage - 用户偏好存储
   */
  constructor(
    private readonly modelService: ModelService,
    private readonly aiController: IAIController,
    private readonly preferenceStorage: IKeyValueStorage
  ) {}

  /**
   * 获取模型列表
   */
  async getModels(): Promise<ModelConfig[]> {
    return this.modelService.getModels();
  }

  /**
   * 切换模型（全局单例）
   */
  async switchModel(
    modelId: string,
    modelUrl?: string,
    onProgress?: DownloadProgressCallback,
    onInitProgress?: (info: { stage: string; message: string; current?: number; total?: number }) => void
  ): Promise<void> {
    // 1. 先保存偏好（包括自定义模型的 URL 和文件名）
    //    这样即使模型加载失败，用户的选择也会被记录
    await this.savePreference(modelId, modelUrl);

    // 2. 获取模型配置
    const models = await this.getModels();
    const model = models.find(m => m.id === modelId);

    // 3. 如果没有找到内置模型，且提供了 URL，则使用外部模型
    const finalUrl = model?.url ?? modelUrl;

    if (!finalUrl) {
      throw new Error(`Model ${modelId} not found and no URL provided`);
    }

    // 4. 提取文件名（用于区分不同模型）
    const fileName = finalUrl.split('/').pop()!;
    
    // 5. 初始化 AI 引擎
    // App 端：KataGoAppAdapter 内部下载
    // Web 端：worker 内部下载
    await this.aiController.init(modelId, finalUrl, onProgress, onInitProgress);

    // 6. 更新当前模型和文件名
    this.currentModelId = modelId;
    this.currentModelFileName = fileName;
  }

  /**
   * 获取当前使用的模型 ID
   */
  getCurrentModel(): string | null {
    return this.currentModelId;
  }

  /**
   * 获取当前使用的模型文件名
   * @description 从 URL 中提取文件名，用于区分不同的模型
   */
  getCurrentModelFileName(): string | null {
    return this.currentModelFileName;
  }

  /**
   * 保存用户偏好
   */
  async savePreference(modelId: string, customModelUrl?: string): Promise<void> {
    // 更新内存中的状态
    this.currentModelId = modelId;
    
    // 保存模型 ID
    await this.preferenceStorage.write('current-model', modelId);
    
    // 提取并保存文件名（用于区分不同模型）
    let fileName = '';
    if (modelId === 'custom' && customModelUrl) {
      // 自定义模型：从 URL 提取文件名
      fileName = customModelUrl.split('/').pop() ?? '';
      // 只保存有效的 HTTP URL
      if (customModelUrl.startsWith('http://') || customModelUrl.startsWith('https://')) {
        await this.preferenceStorage.write('custom-model-url', customModelUrl);
      }
      await this.preferenceStorage.write('current-model-filename', fileName);
    } else if (customModelUrl) {
      // 内置模型但指定了 URL：从 URL 提取文件名
      fileName = customModelUrl.split('/').pop() ?? '';
      await this.preferenceStorage.write('current-model-filename', fileName);
    } else {
      // 内置模型：需要从模型列表中获取文件名
      const models = await this.getModels();
      const model = models.find(m => m.id === modelId);
      if (model?.url) {
        fileName = model.url.split('/').pop() ?? '';
      }
      await this.preferenceStorage.write('current-model-filename', fileName);
      // 注意：不清除 custom-model-url，恢复草稿时需要用到
    }
    
    // 更新内存中的文件名
    this.currentModelFileName = fileName;
  }

  /**
   * 加载用户偏好
   */
  async loadPreference(): Promise<string | null> {
    const modelId = await this.preferenceStorage.read<string>('current-model');
    
    // 如果内存中没有状态，从存储中恢复
    if (modelId && !this.currentModelId) {
      this.currentModelId = modelId;
      
      // 同时恢复文件名
      const fileName = await this.preferenceStorage.read<string>('current-model-filename');
      if (fileName) {
        this.currentModelFileName = fileName;
      }
    }
    
    return modelId;
  }

  /**
   * 加载模型文件名
   * @description 从偏好中加载文件名，用于区分不同模型
   */
  async loadModelFileName(): Promise<string | null> {
    return await this.preferenceStorage.read<string>('current-model-filename');
  }

  /**
   * 加载自定义模型的 URL
   */
  async loadCustomModelUrl(): Promise<string | null> {
    const url = await this.preferenceStorage.read<string>('custom-model-url');
    // 只返回有效的 HTTP URL，过滤旧的脏数据（如 /models/custom.bin.gz）
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      return url;
    }
    return null;
  }
}
