/**
 * @fileoverview 模型管理服务实现
 */

import type { IModelService } from './IModelService';
import type { ModelConfig, ModelList, DownloadProgressCallback, CachedModelInfo, CachedModel } from './types';
import type { IConfigProvider } from '../../infrastructure/config/interfaces/IConfigProvider';
import type { INetworkProvider } from '../../infrastructure/network/interfaces/INetworkProvider';
import type { IDocumentStorage } from '../../infrastructure/storage/interfaces/IDocumentStorage';
import type { IModelConfig } from '../../infrastructure/config/schemas/ModelConfigSchema';
import { ResourceCache } from '../../infrastructure/utils/cache';
import { transformModelConfig, getDownloadUrls, getDefaultModelConfig } from './ModelServiceHelper';

/**
 * 模型管理服务
 */
export class ModelService implements IModelService {
  private config: ModelList | null = null;
  private currentModelId: string | null = null;
  private readonly cache: ResourceCache<Blob>;

  constructor(
    private readonly configProvider: IConfigProvider,
    private readonly networkProvider: INetworkProvider,
    storage: IDocumentStorage<CachedModel>
  ) {
    this.cache = new ResourceCache<Blob>(storage, { keyPrefix: 'model', defaultTTL: 0 });
  }

  async loadConfig(): Promise<ModelList> {
    console.log('[ModelService] loadConfig() called, config exists:', !!this.config);
    
    if (this.config) {
      console.log('[ModelService] Config already loaded, returning cached config');
      return this.config;
    }
    
    try {
      // 尝试从配置提供者加载
      if (this.configProvider) {
        const modelConfig = await this.configProvider.getModuleConfig<IModelConfig>('model');
        // 检查配置是否有效（包含 models 数组）
        if (modelConfig?.models && Array.isArray(modelConfig.models) && modelConfig.models.length > 0) {
          this.config = transformModelConfig(modelConfig);
          return this.config;
        }
      }
      
      // 如果没有配置提供者或配置无效，尝试从文件加载
      // 使用 getWebRoot() 获取正确的 web 根目录
      const { getWebRoot } = await import('../../infrastructure/utils/web/pathUtils');
      const webRoot = getWebRoot();
      const configUrl = webRoot + 'models/model-config.json';
      
      const response = await fetch(configUrl);
      if (response.ok) {
        const modelConfig = await response.json();
        this.config = transformModelConfig(modelConfig);
        return this.config;
      }
      
      throw new Error('No model config available');
    } catch (error) {
      console.warn('Failed to load model config, using default:', error);
      this.config = getDefaultModelConfig();
      return this.config;
    }
  }

  async getModels(): Promise<ModelConfig[]> {
    if (!this.config) await this.loadConfig();
    return this.config?.models ?? [];
  }

  async downloadModel(id: string, onProgress?: DownloadProgressCallback, model?: ModelConfig): Promise<void> {
    console.log('[ModelService] downloadModel() called, id:', id);
    
    // 如果没有传入 model，则查找
    if (!model) {
      model = await this.findModel(id);
      if (!model) {
        console.error('[ModelService] Model not found:', id);
        throw new Error(`Model ${id} not found`);
      }
    }

    console.log('[ModelService] Downloading model:', model.name, 'size:', model.size, 'url:', model.url);

    const config = await this.configProvider.getModuleConfig<IModelConfig>('model');
    const urls = getDownloadUrls(model);

    // 标记是否真的下载了
    let wasDownloaded = false;
    
    await this.cache.getOrDownload(
      id,
      async () => {
        wasDownloaded = true;  // 标记为已下载
        return this.downloadWithProgress(urls, model.sizeBytes, onProgress);
      },
      config?.modelCacheTTL ?? 0
    );
    
    // 如果是从缓存加载（没有调用 downloader），显示进度完成
    if (!wasDownloaded && onProgress && model.sizeBytes > 0) {
      console.log('[ModelService] Model loaded from cache, showing 100% progress');
      onProgress(model.sizeBytes, model.sizeBytes, 100);
    }
  }

  async switchModel(id: string, onProgress?: DownloadProgressCallback): Promise<void> {
    console.log('[ModelService] switchModel() called, id:', id);
    
    // 只切换模型 ID，不下载（由 Worker 负责下载）
    this.currentModelId = id;
    
    // 通知进度完成（让用户知道模型已就绪）
    const model = await this.findModel(id);
    if (onProgress && model && model.sizeBytes > 0) {
      onProgress(model.sizeBytes, model.sizeBytes, 100);
    }
  }

  getCurrentModel(): ModelConfig | null {
    if (!this.currentModelId || !this.config) return null;
    return this.config.models.find(m => m.id === this.currentModelId) ?? null;
  }

  async isCached(id: string): Promise<boolean> {
    return this.cache.isCached(id);
  }

  async getCachedModels(): Promise<CachedModelInfo[]> {
    const storage = this.cache.getStorage() as IDocumentStorage<CachedModel>;
    const cachedModels = await storage.find();
    return cachedModels.map(m => ({ id: m.id, timestamp: m.timestamp, size: m.size }));
  }

  async deleteCache(id: string): Promise<void> {
    await this.cache.clear(id);
  }

  async clearAllCache(): Promise<void> {
    await this.cache.clearAll();
  }

  private async findModel(id: string): Promise<ModelConfig | undefined> {
    const models = await this.getModels();
    return models.find(m => m.id === id);
  }

  private async downloadWithProgress(
    urls: string[], expectedSize: number, onProgress?: DownloadProgressCallback
  ): Promise<Blob> {
    let lastError: Error | null = null;

    for (const url of urls) {
      try {
        const response = await this.networkProvider.request<Blob>({
          url, method: 'GET', responseType: 'blob',
          expectedSize, // 传递期望的文件大小
          onProgress: onProgress
            ? (loaded, total, progress) => onProgress(loaded, total, progress)
            : undefined,
        });
        return response.data;
      } catch (error) {
        console.error(`Failed to download from ${url}:`, error);
        lastError = error as Error;
      }
    }

    throw new Error(`Failed to download: ${lastError?.message}`);
  }
}