/**
 * @fileoverview KataGo 远程适配器
 * @description 通过 WebRTC 隧道远程调用服务端的 KataGo，实现 IAIEngine 接口
 *
 * 工作原理：
 * - 懒连接：首次调用任意方法时才通过 TunnelManager 建立隧道连接
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
import { WebToast } from '../../../presentation/adapters/web/components/Toast';

/** RPC 超时：初始化可能较慢（模型下载等），给 10 分钟 */
const INIT_TIMEOUT = 600_000;
/** 分析超时：整盘分析可能较久，给 30 分钟 */
const ANALYZE_GAME_TIMEOUT = 1_800_000;

/** 共享 toast 实例（延迟创建） */
let sharedToast: WebToast | null = null;
function getToast(): WebToast {
  if (!sharedToast) sharedToast = new WebToast();
  return sharedToast;
}

export class KataGoRemoteAdapter implements IAIEngine {
  private engineInfo: EngineInfo = { backend: 'remote', modelName: null };
  private tunnelClient: TunnelClient | null = null;
  /** 是否正在显示连接提示 */
  private connectingToastShown = false;

  /**
   * 等待隧道连接就绪（懒连接）
   * 首次调用时通过 TunnelManager 建立连接，连接过程中给用户进度提示
   */
  private async ensureConnected(): Promise<TunnelClient> {
    if (this.tunnelClient && this.tunnelClient.isConnected) {
      return this.tunnelClient;
    }

    // 提示用户正在连接
    if (!this.connectingToastShown) {
      this.connectingToastShown = true;
      getToast().info('正在连接远程服务端...', 30000);
    }

    const client = await TunnelManager.getInstance().waitForConnection();
    if (!client || !client.isConnected) {
      this.connectingToastShown = false;
      getToast().error('远程服务端不在线，请检查服务端是否已启动并连接信令服务器', 5000);
      throw new Error('远程服务端不在线，请检查服务端是否已启动并连接信令服务器');
    }
    this.tunnelClient = client;
    this.connectingToastShown = false;
    getToast().success('远程服务端已连接', 2000);
    return client;
  }

  async init(options: AIEngineInitOptions): Promise<void> {
    const client = await this.ensureConnected();

    // 检查服务端是否已加载相同模型，避免重复 init
    try {
      const info = await client.call('katago', 'getEngineInfo', undefined) as EngineInfo;
      if (info.modelName) {
        // 服务端已有引擎，检查是否是同一模型
        const requestFileName = options.modelUrl?.split('/').pop() ?? '';
        const serverFileName = info.modelName;
        if (requestFileName === serverFileName) {
          console.info('[KataGoRemoteAdapter] Server already loaded same model:', serverFileName);
          this.engineInfo = info;
          return;
        }
        // 模型不同，但服务端已加载 — 不重新 init（服务端的模型由服务端决定）
        console.info('[KataGoRemoteAdapter] Server has model:', serverFileName, '(requested:', requestFileName, '), using server model');
        this.engineInfo = info;
        return;
      }
    } catch {
      // 获取引擎信息失败，继续尝试 init
    }

    // 服务端未加载模型，发送 init RPC
    const serializableOptions: AIEngineInitOptions = {
      modelUrl: options.modelUrl,
    };
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
    // 懒连接：通过 ensureConnected 确保隧道就绪
    const client = await this.ensureConnected();
    return client.call('katago', 'listModels', undefined) as Promise<ModelInfo[]>;
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
