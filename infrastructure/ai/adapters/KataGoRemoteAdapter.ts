/**
 * @fileoverview KataGo 远程适配器
 * @description 通过 WebRTC 隧道远程调用服务端的 KataGo，实现 IAIEngine 接口
 *
 * 工作原理：
 * - init() 时通过 TunnelManager 等待隧道连接就绪
 * - 所有 IAIEngine 方法调用都通过 TunnelClient.call('katago', method, params) 远程执行
 * - 上层代码（AIController 等）完全无感知，使用方式与本地适配器一致
 */

import type { AnalysisResult } from '@weiqi/worker';
import type {
  IAIEngine,
  AIEngineInitOptions,
  AnalyzeOptions,
  EvaluateOptions,
  EvaluateBatchOptions,
  EngineInfo,
  AnalyzeGameOptions,
  GameTurnAnalysis,
  ModelInfo,
} from '../IAIEngine';
import { TunnelManager } from '../../tunnel/TunnelManager';
import type { TunnelClient } from '../../tunnel/TunnelClient';

/** RPC 超时：初始化可能较慢（模型下载等），给 10 分钟 */
const INIT_TIMEOUT = 600_000;
/** 分析超时：整盘分析可能较久，给 30 分钟 */
const ANALYZE_GAME_TIMEOUT = 1_800_000;

export class KataGoRemoteAdapter implements IAIEngine {
  private engineInfo: EngineInfo = { backend: 'remote', modelName: null };
  private tunnelClient: TunnelClient | null = null;

  /**
   * 等待隧道连接就绪
   * 由 init() 调用，也可由其他方法在 tunnelClient 为空时调用
   */
  private async ensureConnected(): Promise<TunnelClient> {
    if (this.tunnelClient && this.tunnelClient.isConnected) {
      return this.tunnelClient;
    }
    const client = await TunnelManager.getInstance().waitForConnection();
    if (!client || !client.isConnected) {
      throw new Error('远程隧道未连接');
    }
    this.tunnelClient = client;
    return client;
  }

  async init(options: AIEngineInitOptions): Promise<void> {
    const client = await this.ensureConnected();

    // 保留回调，去掉无法序列化的函数
    const serializableOptions: AIEngineInitOptions = {
      modelUrl: options.modelUrl,
    };
    // 合并 onProgress + onInitProgress 为统一回调
    const progressCb = options.onProgress || options.onInitProgress
      ? (data: any) => {
          if (data.type === 'download' && options.onProgress) {
            options.onProgress(data.loaded, data.total, data.progress);
          } else if (data.type === 'init' && options.onInitProgress) {
            options.onInitProgress(data);
          }
        }
      : undefined;
    await client.call('katago', 'init', serializableOptions, progressCb, INIT_TIMEOUT);

    // init 成功后获取引擎信息
    try {
      const info = await client.call('katago', 'getEngineInfo', undefined) as EngineInfo;
      this.engineInfo = info;
    } catch {
      // 获取引擎信息失败不影响使用
    }
  }

  async analyze(options: AnalyzeOptions): Promise<AnalysisResult> {
    const client = await this.ensureConnected();
    const serializableOptions: any = { ...options };
    delete serializableOptions.onProgress;
    return client.call('katago', 'analyze', serializableOptions) as Promise<AnalysisResult>;
  }

  async analyzeGame(options: AnalyzeGameOptions): Promise<GameTurnAnalysis[]> {
    const client = await this.ensureConnected();
    const serializableOptions: any = { ...options };
    delete serializableOptions.onResultProgress;
    const onProgress = options.onResultProgress
      ? (data: unknown) => {
          const p = data as { current: number; total: number };
          options.onResultProgress!(p.current, p.total);
        }
      : undefined;
    return client.call('katago', 'analyzeGame', serializableOptions, onProgress, ANALYZE_GAME_TIMEOUT) as Promise<GameTurnAnalysis[]>;
  }

  async evaluate(options: EvaluateOptions): Promise<any> {
    const client = await this.ensureConnected();
    return client.call('katago', 'evaluate', options);
  }

  async evaluateBatch(options: EvaluateBatchOptions): Promise<any[]> {
    const client = await this.ensureConnected();
    return client.call('katago', 'evaluateBatch', options) as Promise<any[]>;
  }

  async listModels(): Promise<ModelInfo[]> {
    // 快速尝试连接（5 秒超时），连不上就返回空让调用方 fallback
    if (!this.tunnelClient || !this.tunnelClient.isConnected) {
      const client = await Promise.race([
        TunnelManager.getInstance().waitForConnection(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
      ]);
      if (!client || !client.isConnected) {
        console.warn('[KataGoRemoteAdapter] listModels: tunnel not connected, returning empty');
        return [];
      }
      this.tunnelClient = client;
    }
    return this.tunnelClient.call('katago', 'listModels', undefined) as Promise<ModelInfo[]>;
  }

  getEngineInfo(): EngineInfo {
    return this.engineInfo;
  }
}

/**
 * 创建远程适配器实例
 */
export function createKataGoRemoteAdapter(): KataGoRemoteAdapter {
  return new KataGoRemoteAdapter();
}
