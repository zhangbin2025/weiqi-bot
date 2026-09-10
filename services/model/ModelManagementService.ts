/**
 * @fileoverview 模型管理服务实现
 * @description 统一的模型管理服务，负责模型选择、切换和用户偏好管理
 */

import type { IModelManagementService } from './IModelManagementService';
import type { ModelConfig, DownloadProgressCallback } from './types';
import type { ModelInfo } from '../../infrastructure/ai/IAIEngine';
import { TunnelManager } from '../../infrastructure/tunnel/TunnelManager';
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
   * 
   * 远程隧道模式下从服务端获取模型列表（含大模型），
   * 本地模式下从 model-config.json 加载。
   */
  async getModels(): Promise<ModelConfig[]> {
    // 仅在远程隧道客户端模式下从服务端获取模型列表
    // 服务端模式/本地模式使用本地 model-config.json
    if (TunnelManager.getInstance().isClientMode() && typeof this.aiController.listModels === 'function') {
      try {
        const remoteModels = await this.aiController.listModels();
        if (remoteModels.length > 0) {
          // 转换 ModelInfo → ModelConfig
          // url: 自定义模型由服务端提供 URL（客户端展示用），内置模型为空
          return remoteModels.map(m => {
            const cfg: ModelConfig = {
              id: m.id,
              name: m.name,
              description: '',
              url: m.url || '',
              size: m.size,
              sizeBytes: 0,
              version: '',
              blocks: 0,
              isDefault: m.isDefault,
              features: { fastInference: false, lowMemory: false },
            };
            if (m.isCurrent) cfg.isCurrent = true;
            return cfg;
          });
        }
      } catch (e) {
        console.warn('[ModelManagementService] Failed to get remote models, falling back to local:', e);
      }
    }
    // Fallback: 本地模型列表
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
    // 1. 保存偏好（远程客户端模式不保存，避免远程配置覆盖本地）
    if (!TunnelManager.getInstance().isClientMode()) {
      await this.savePreference(modelId, modelUrl);
    }

    // 2. 确定模型 URL
    let finalUrl: string;

    if (TunnelManager.getInstance().isClientMode()) {
      // 远程客户端模式：模型由服务端管理
      // 自定义模型传 URL；内置模型用服务端标准路径格式
      finalUrl = modelUrl || `/models/${modelId}.bin.gz`;
    } else {
      // 本地模式：从模型列表获取 URL
      const models = await this.getModels();
      const model = models.find(m => m.id === modelId);
      finalUrl = model?.url || modelUrl || '';

      if (!finalUrl) {
        throw new Error(`Model ${modelId} not found and no URL provided`);
      }
    }

    // 3. 提取文件名（用于区分不同模型）
    const fileName = finalUrl.split('/').pop()!;
    
    // 4. 初始化 AI 引擎
    // 远程客户端：RPC 到服务端
    // App 端：KataGoAppAdapter 内部下载
    // Web 端：worker 内部下载
    await this.aiController.init(modelId, finalUrl, onProgress, onInitProgress);

    // 5. 更新当前模型和文件名
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
