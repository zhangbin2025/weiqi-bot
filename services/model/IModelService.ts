/**
 * @fileoverview 模型管理服务接口
 */

import type {
  ModelConfig,
  ModelList,
  DownloadProgressCallback,
  CachedModelInfo,
} from './types';

/**
 * 模型管理服务接口
 *
 * 负责管理 AI 模型的下载、缓存和切换。
 *
 * @ai-example
 * const service: IModelService = new ModelService();
 * await service.loadConfig();
 *
 * const models = await service.getModels();
 * const current = service.getCurrentModel();
 *
 * await service.downloadModel('katago-small', (loaded, total, progress) => {
 *   console.log(`Progress: ${progress}%`);
 * });
 *
 * await service.switchModel('katago-small');
 * await service.deleteCache('old-model');
 */
export interface IModelService {
  /**
   * 加载模型配置
   * @returns 模型列表
   * @throws 如果配置加载失败且无法使用默认配置
   * @ai-example
   * const list = await service.loadConfig();
   * console.log(list.models.length);
   */
  loadConfig(): Promise<ModelList>;

  /**
   * 获取所有可用模型
   * @returns 模型配置列表
   * @ai-example
   * const models = await service.getModels();
   * models.forEach(m => console.log(m.name));
   */
  getModels(): Promise<ModelConfig[]>;

  /**
   * 下载模型
   * @param id - 模型 ID
   * @param onProgress - 进度回调（可选）
   * @throws 如果模型不存在或下载失败
   * @ai-example
   * await service.downloadModel('katago-small', (loaded, total, progress) => {
   *   console.log(`Downloaded: ${loaded}/${total} (${progress}%)`);
   * });
   */
  downloadModel(id: string, onProgress?: DownloadProgressCallback): Promise<void>;

  /**
   * 切换模型
   * @param id - 模型 ID
   * @param onProgress - 进度回调（可选）
   * @throws 如果模型不存在或加载失败
   * @ai-example
   * await service.switchModel('katago-small');
   */
  switchModel(id: string, onProgress?: DownloadProgressCallback): Promise<void>;

  /**
   * 获取当前模型
   * @returns 当前模型配置或 null
   * @ai-example
   * const current = service.getCurrentModel();
   * if (current) {
   *   console.log(`Using: ${current.name}`);
   * }
   */
  getCurrentModel(): ModelConfig | null;

  /**
   * 检查模型是否已缓存
   * @param id - 模型 ID
   * @returns 是否已缓存
   * @ai-example
   * if (await service.isCached('katago-small')) {
   *   console.log('Model already cached');
   * }
   */
  isCached(id: string): Promise<boolean>;

  /**
   * 获取所有已缓存的模型信息
   * @returns 缓存模型信息列表
   * @ai-example
   * const cached = await service.getCachedModels();
   * cached.forEach(m => console.log(`${m.id}: ${m.size} bytes`));
   */
  getCachedModels(): Promise<CachedModelInfo[]>;

  /**
   * 删除模型缓存
   * @param id - 模型 ID
   * @throws 如果删除失败
   * @ai-example
   * await service.deleteCache('old-model');
   */
  deleteCache(id: string): Promise<void>;

  /**
   * 清空所有缓存
   * @ai-example
   * await service.clearAllCache();
   */
  clearAllCache(): Promise<void>;
}