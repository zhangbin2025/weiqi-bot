/**
 * @fileoverview 复盘模型管理器
 * @description 封装复盘场景下的 AI 模型加载、就绪等待、模型列表查询等逻辑。
 *   从 clients/web/review/index.ts 的闭包逻辑中提取，消除 window 全局变量依赖。
 * 
 * @deprecated 已废弃，请使用 ModelManagementService 统一管理模型
 */

import type { IAIController } from '../../services/ai/IAIController';
import type { IModelService, ModelConfig } from '../../services/model';
import type { IAIEngine, EngineInfo } from '../../infrastructure/ai/IAIEngine';

/** 模型加载进度回调 */
export type ModelProgressCallback = (loaded: number, total: number, progress: number) => void;

/** 模型列表条目（供展示层使用） */
export interface ModelListItem {
  id: string;
  name: string;
  size: string;
}

/** 后端信息（供展示层渲染） */
export interface BackendInfo {
  /** 后端标识：webgpu / webgl / wasm / cpu / unknown */
  backend: string;
  /** 可读标签 */
  label: string;
}

/** 模型加载结果 */
export interface ModelLoadResult {
  /** 加载的模型 ID */
  modelId: string;
  /** 模型名称 */
  modelName: string;
  /** 后端信息 */
  backendInfo: BackendInfo;
}

/**
 * 复盘模型管理器
 *
 * 职责：
 * - 根据模型 ID 查找配置、构建 URL、调用 AIController 初始化
 * - 管理模型就绪状态，提供等待就绪的能力
 * - 查询模型列表
 * - 检测后端信息
 */
export class ReviewModelManager {
  private aiController: IAIController;
  private modelService: IModelService;
  private aiEngine: IAIEngine;

  private initialized = false;
  private currentModelId: string | null = null;

  constructor(
    aiController: IAIController,
    modelService: IModelService,
    aiEngine: IAIEngine,
  ) {
    this.aiController = aiController;
    this.modelService = modelService;
    this.aiEngine = aiEngine;
  }

  /**
   * 加载模型（带进度回调）
   * @param modelId - 目标模型 ID（不传则使用默认）
   * @param onProgress - 进度回调
   * @param webRoot - Web 根目录（用于构建模型 URL）
   */
  async loadModel(
    modelId?: string,
    onProgress?: ModelProgressCallback,
    webRoot?: string,
  ): Promise<ModelLoadResult> {
    // 获取默认模型配置
    const models = await this.modelService.getModels();
    const targetModelId = modelId || models[0]?.id || 'katago-small';
    const model = await this.findModel(targetModelId);

    if (!model) {
      throw new Error(`Model ${targetModelId} not found`);
    }

    // 如果已经初始化且是同一个模型，直接返回
    if (this.initialized && this.currentModelId === targetModelId) {
      console.info('模型已加载，跳过:', targetModelId);
      return this.buildResult(targetModelId, model.name);
    }

    // 构建模型 URL
    const modelUrl = this.buildModelUrl(model, targetModelId, webRoot ?? '');

    console.info('开始加载模型:', targetModelId, 'url:', modelUrl);

    // 初始化 AI
    await this.aiController.init(targetModelId, modelUrl, (loaded, total, progress) => {
      onProgress?.(loaded, total, progress);
    });

    // 等待后端完全准备好（WebGL/WASM/CPU）
    await new Promise(resolve => setTimeout(resolve, 2000));

    this.initialized = true;
    this.currentModelId = targetModelId;

    const backendInfo = this.detectBackend();

    console.info('AI 模型加载完成', {
      backend: backendInfo.backend,
      label: backendInfo.label,
    });

    return {
      modelId: targetModelId,
      modelName: model.name || targetModelId,
      backendInfo,
    };
  }

  /**
   * 等待模型就绪
   * @param maxWaitMs - 最大等待时间（毫秒）
   */
  async waitForReady(maxWaitMs = 120000): Promise<void> {
    const startTime = Date.now();

    while (!this.initialized) {
      if (Date.now() - startTime > maxWaitMs) {
        throw new Error('AI初始化超时');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // 额外等待一下，确保 AI 完全准备好
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  /**
   * 获取模型列表（供展示层使用）
   */
  async getModelList(): Promise<ModelListItem[]> {
    const models = await this.modelService.getModels();
    return models.map(m => ({
      id: m.id,
      name: m.name,
      size: m.size,
    }));
  }

  /**
   * 是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 获取当前模型 ID
   */
  getCurrentModelId(): string | null {
    return this.currentModelId;
  }

  /**
   * 检测后端信息
   */
  detectBackend(): BackendInfo {
    const engineInfo: EngineInfo = this.aiEngine.getEngineInfo();
    const backend = engineInfo.backend || 'unknown';
    const label = backend === 'webgpu' ? 'WebGPU (GPU加速)' :
                  backend === 'webgl' ? 'WebGL (GPU加速)' :
                  backend === 'wasm' ? 'WASM (CPU多线程)' :
                  backend === 'cpu' ? 'CPU (纯CPU)' : backend;
    return { backend, label };
  }

  /**
   * 查找模型配置（内部使用，替代 ModelService.findModel private 方法）
   */
  private async findModel(id: string): Promise<ModelConfig | undefined> {
    const models = await this.modelService.getModels();
    return models.find(m => m.id === id);
  }

  /**
   * 构建模型 URL
   */
  private buildModelUrl(model: ModelConfig, modelId: string, webRoot: string): string {
    if (model.url) {
      if (model.url.startsWith('http://') || model.url.startsWith('https://') || model.url.startsWith('/')) {
        return model.url;
      }
      return webRoot + model.url;
    }
    return `${webRoot}models/${modelId}.bin.gz`;
  }

  /**
   * 构建加载结果（已初始化时的快捷路径）
   */
  private buildResult(modelId: string, modelName: string): ModelLoadResult {
    const backendInfo = this.detectBackend();
    return { modelId, modelName, backendInfo };
  }
}
