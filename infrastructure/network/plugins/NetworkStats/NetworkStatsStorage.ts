/**
 * 网络统计存储（集成 storage 模块）
 * @description 存储和计算网络统计数据，支持多种存储后端
 */

import type { IKeyValueStorage } from '../../../storage/interfaces/IKeyValueStorage';
import type {
  INetworkStats,
  IUrlStats,
  IMethodStats,
  IProviderStats,
  INetworkStatsConfig
} from './NetworkStatsTypes';
import type { IStatsData, IStoredStats } from './NetworkStatsData';
import { MemoryStorageAdapter } from './MemoryStorageAdapter';
import { createEmptyStats, updateStats } from './NetworkStatsData';
import { calculateStats, normalizeUrl } from './NetworkStatsCalculator';

/**
 * 网络统计存储
 */
export class NetworkStatsStorage {
  private config: INetworkStatsConfig;
  private storage: IKeyValueStorage;
  private globalStats: IStatsData;
  private urlStats: Map<string, IStatsData> = new Map();
  private methodStats: Map<string, IStatsData> = new Map();
  private providerStats: Map<string, IStatsData> = new Map();

  constructor(config: INetworkStatsConfig = {}, storage?: IKeyValueStorage) {
    this.config = config;
    this.storage = storage ?? new MemoryStorageAdapter();
    this.globalStats = createEmptyStats();
  }

  /**
   * 设置存储适配器
   */
  async setStorage(storage: IKeyValueStorage): Promise<void> {
    this.storage = storage;
    await this.loadFromStorage();
  }

  /**
   * 从存储加载统计数据
   */
  private async loadFromStorage(): Promise<void> {
    const stored = await this.storage.read<IStoredStats>('network-stats');
    if (stored) {
      this.globalStats = stored.global;
      this.urlStats = new Map(Object.entries(stored.urls));
      this.methodStats = new Map(Object.entries(stored.methods));
      this.providerStats = new Map(Object.entries(stored.providers));
    }
  }

  /**
   * 保存统计数据到存储
   */
  private async saveToStorage(): Promise<void> {
    const data: IStoredStats = {
      global: this.globalStats,
      urls: Object.fromEntries(this.urlStats),
      methods: Object.fromEntries(this.methodStats),
      providers: Object.fromEntries(this.providerStats)
    };
    await this.storage.write('network-stats', data);
  }

  /**
   * 记录请求
   */
  async recordRequest(
    url: string,
    method: string,
    provider: string,
    success: boolean,
    responseTime: number,
    bytes: number = 0
  ): Promise<void> {
    this.updateGlobalStats(success, responseTime, bytes);
    this.updateUrlStats(url, success, responseTime, bytes);
    this.updateMethodStats(method, success, responseTime, bytes);
    this.updateProviderStats(provider, success, responseTime, bytes);
    await this.saveToStorage();
  }

  private updateGlobalStats(success: boolean, responseTime: number, bytes: number): void {
    updateStats(this.globalStats, success, responseTime, bytes);
  }

  private updateUrlStats(url: string, success: boolean, responseTime: number, bytes: number): void {
    if (this.config.groupByUrl !== false) {
      const urlKey = normalizeUrl(url);
      if (!this.urlStats.has(urlKey)) {
        this.urlStats.set(urlKey, createEmptyStats());
      }
      updateStats(this.urlStats.get(urlKey)!, success, responseTime, bytes);
    }
  }

  private updateMethodStats(method: string, success: boolean, responseTime: number, bytes: number): void {
    if (this.config.groupByMethod !== false) {
      const methodKey = method.toUpperCase();
      if (!this.methodStats.has(methodKey)) {
        this.methodStats.set(methodKey, createEmptyStats());
      }
      updateStats(this.methodStats.get(methodKey)!, success, responseTime, bytes);
    }
  }

  private updateProviderStats(provider: string, success: boolean, responseTime: number, bytes: number): void {
    if (this.config.groupByProvider !== false) {
      if (!this.providerStats.has(provider)) {
        this.providerStats.set(provider, createEmptyStats());
      }
      updateStats(this.providerStats.get(provider)!, success, responseTime, bytes);
    }
  }

  /**
   * 获取全局统计
   */
  getGlobalStats(): INetworkStats {
    return calculateStats(this.globalStats);
  }

  /**
   * 按URL统计
   */
  getUrlStats(): IUrlStats[] {
    const result: IUrlStats[] = [];
    this.urlStats.forEach((stats, url) => {
      result.push({
        url,
        ...calculateStats(stats),
        requestCount: stats.totalRequests
      });
    });
    return result.sort((a, b) => b.requestCount - a.requestCount);
  }

  /**
   * 按方法统计
   */
  getMethodStats(): IMethodStats[] {
    const result: IMethodStats[] = [];
    this.methodStats.forEach((stats, method) => {
      result.push({
        method,
        ...calculateStats(stats),
        requestCount: stats.totalRequests
      });
    });
    return result.sort((a, b) => b.requestCount - a.requestCount);
  }

  /**
   * 按提供者统计
   */
  getProviderStats(): IProviderStats[] {
    const result: IProviderStats[] = [];
    this.providerStats.forEach((stats, provider) => {
      result.push({
        provider,
        ...calculateStats(stats),
        requestCount: stats.totalRequests
      });
    });
    return result.sort((a, b) => b.requestCount - a.requestCount);
  }

  /**
   * 清空统计
   */
  async clear(): Promise<void> {
    this.globalStats = createEmptyStats();
    this.urlStats.clear();
    this.methodStats.clear();
    this.providerStats.clear();
    await this.storage.delete('network-stats');
  }
}