/**
 * @fileoverview KataGo App 适配器
 * @description 在 App 环境中通过原生桥接调用 KataGo 进程
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
} from '../IAIEngine';
import {
  getKataGoNativeClient,
  type KataGoStartOptions,
} from '../../katago/KataGoNativeClient';
import { KataGoQueryBuilder } from '../../katago/KataGoQueryBuilder';
import { KataGoResultParser } from '../../katago/KataGoResultParser';
import type { NetworkManager } from '../../network/core/NetworkManager';

/**
 * KataGo App 适配器
 *
 * 通过原生桥接调用 KataGo 进程，实现 IAIEngine 接口。
 *
 * 核心优势：
 * - analyzeGame() 一次请求分析整盘棋，利用 KataGo 原生批量分析
 * - 支持 OpenCL GPU 加速
 * - 性能远超 Web Worker 方案
 */
export class KataGoAppAdapter implements IAIEngine {
  private client = getKataGoNativeClient();
  private engineInfo: EngineInfo = { backend: null, modelName: null };
  private initialized = false;

  /**
   * 创建 KataGo App 适配器
   * @param networkManager - 网络管理器（可选，用于代理下载非同源模型）
   */
  constructor(private networkManager?: NetworkManager) {}

  /**
   * 初始化引擎（启动原生 KataGo 进程）
   *
   * modelUrl 是 web 相对路径（如 "models/katago-small.bin.gz"），
   * Kotlin 层自动解析为 filesDir/web/{modelUrl}
   *
   * 启动前先通过 HTTP 触发 AssetServer 下载模型文件到本地，
   * 确保文件存在于 filesDir/web/{modelUrl}。
   */
  async init(options: AIEngineInitOptions): Promise<void> {
    console.info('[KataGoAppAdapter] init() called, options.modelUrl:', options.modelUrl);
    
    // 提取新模型的文件名
    const newModelName = options.modelUrl.split('/').pop();
    console.info('[KataGoAppAdapter] New model name:', newModelName);
    
    // 检查进程状态（不依赖 TypeScript 层的状态变量）
    let isRunning = false;
    try {
      isRunning = await this.checkProcessStatus();
      console.info('[KataGoAppAdapter] Process running:', isRunning);
    } catch (error) {
      console.error('[KataGoAppAdapter] Failed to check process status:', error);
    }
    
    // 如果进程在运行，总是关闭它（避免模型冲突）
    if (isRunning) {
      // 检查是否有运行中的任务
      if (this.client.hasRunningTasks()) {
        console.error('[KataGoAppAdapter] Cannot switch model: has running tasks');
        const error = new Error(`模型切换失败：有正在运行的 AI 任务，请等待完成后再切换模型`);
        (error as any).code = 'MODEL_SWITCH_WITH_RUNNING_TASKS';
        throw error;
      }
      
      console.info('[KataGoAppAdapter] Process is running, shutting down...');
      try {
        await this.client.shutdown();
        console.info('[KataGoAppAdapter] Process shutdown complete');
      } catch (error) {
        console.error('[KataGoAppAdapter] Failed to shutdown process:', error);
        // 继续执行，尝试启动新进程
      }
    }

    // 检测是否是外部 URL
    const isExternalUrl = options.modelUrl.startsWith('http://') || options.modelUrl.startsWith('https://');
    let modelPath = options.modelUrl;
    let downloadUrl: string;
    
    if (isExternalUrl) {
      // 外部模型：直接使用传入的 URL
      const filename = options.modelUrl.split('/').pop()!;
      modelPath = `models/${filename}`;
      downloadUrl = options.modelUrl;
      console.info('[KataGoAppAdapter] External model detected, local path:', modelPath);
    } else {
      // 内置模型：构造远程 URL，通过桥接接口下载
      // 规范化 modelPath（去除前缀 /）
      const normalizedPath = modelPath.startsWith('/') ? modelPath.slice(1) : modelPath;
      modelPath = normalizedPath;
      downloadUrl = `https://bot.weiqi.lol/${normalizedPath}`;
      console.info('[KataGoAppAdapter] Built-in model detected, remote URL:', downloadUrl);
    }
    
    // 通过桥接接口下载模型（统一处理外部和内置模型）
    const filename = modelPath.split('/').pop()!;
    
    // 设置下载进度回调
    if (options.onProgress) {
      this.client.onDownloadProgress = (info) => {
        console.log(`[KataGoAppAdapter] Download progress: ${info.loaded}/${info.total} (${(info.progress * 100).toFixed(1)}%)`);
        // 注意：info.progress 是 0-1 之间的值，需要乘以 100 转换为百分比
        options.onProgress!(info.loaded, info.total, info.progress * 100);
      };
    }
    
    // ⚠️ 关键：先创建 Promise 和回调，再调用 prompt()
    // 避免 Kotlin 层推送消息时 TypeScript 层还没设置回调
    let downloadResolve: (() => void) | null = null;
    let downloadReject: ((error: Error) => void) | null = null;
    const downloadPromise = new Promise<void>((resolve, reject) => {
      downloadResolve = resolve;
      downloadReject = reject;
    });
    
    // 设置下载完成回调（在 prompt 之前）
    const originalOnDownloadComplete = this.client.onDownloadComplete;
    const timeoutId = setTimeout(() => {
      downloadReject?.(new Error('Download timeout (5 minutes)'));
    }, 5 * 60 * 1000);
    
    this.client.onDownloadComplete = (info) => {
      console.info('[KataGoAppAdapter] Download complete callback:', info);
      clearTimeout(timeoutId);
      this.client.onDownloadComplete = originalOnDownloadComplete;
      
      if (info.ok) {
        downloadResolve?.();
      } else {
        downloadReject?.(new Error(info.error || 'Download failed'));
      }
    };
    
    // 调用 katago:downloadModel 下载模型
    const downloadCmd = JSON.stringify({
      url: downloadUrl,
      filename: filename
    });
    console.info('[KataGoAppAdapter] Calling katago:downloadModel:', downloadCmd);
    
    try {
      const result = prompt(`katago:downloadModel:${downloadCmd}`);
      console.info('[KataGoAppAdapter] Download result:', result);
      
      const response = JSON.parse(result || '{}');
      if (!response.ok) {
        clearTimeout(timeoutId);
        this.client.onDownloadComplete = originalOnDownloadComplete;
        throw new Error(response.error || 'Download failed');
      }
      
      // 如果是异步下载，等待下载完成的消息
      if (response.async) {
        console.info('[KataGoAppAdapter] Download is async, waiting for completion...');
        await downloadPromise;
      }
      
      console.info('[KataGoAppAdapter] Model ready:', modelPath);
    } catch (e) {
      console.error('[KataGoAppAdapter] Model download failed:', e);
      throw e;
    } finally {
      // 清除下载进度回调
      this.client.onDownloadProgress = undefined;
    }

    // 触发 analysis.cfg 下载（同模型一样走 AssetServer）
    const configUrl = '/katago/analysis.cfg';
    console.info('[KataGoAppAdapter] Downloading config via AssetServer:', configUrl);
    try {
      if (this.networkManager) {
        // 使用 NetworkManager 下载
        await this.networkManager.request({
          url: configUrl,
          method: 'GET',
          responseType: 'arraybuffer',
        });
      } else {
        // fallback: 直接 fetch
        const cfgResp = await fetch(configUrl);
        if (!cfgResp.ok) {
          throw new Error(`Failed to download config: ${cfgResp.status} ${cfgResp.statusText}`);
        }
        await cfgResp.arrayBuffer();
      }
      console.info('[KataGoAppAdapter] Config downloaded via AssetServer');
    } catch (e) {
      console.error('[KataGoAppAdapter] Config download failed:', e);
      throw e;
    }

    // 启动 KataGo 进程（Kotlin 层从 filesDir/web/ 读取模型和配置文件）
    const startOpts: KataGoStartOptions = {
      modelPath: modelPath,
      configPath: configUrl,
    };

    // 设置初始化进度回调，转发到底层
    if (options.onInitProgress) {
      this.client.onInitProgress = (info) => {
        console.log(`[KataGoAppAdapter] Init progress: ${info.stage} - ${info.message}`);
        
        // 提取简洁的进度信息
        let displayMessage = info.message || '';
        
        // 如果是 Tuning 消息，用正则提取 "Tuning 数字/数字" 格式
        if (info.stage === 'tuning' && displayMessage.includes('Tuning')) {
          const match = displayMessage.match(/Tuning \d+\/\d+/);
          if (match) {
            displayMessage = match[0];
          }
        }
        
        // 通知上层初始化进度
        const progressInfo: { stage: string; message: string; current?: number; total?: number } = {
          stage: info.stage,
          message: displayMessage,
        };
        if (info.current !== undefined) progressInfo.current = info.current;
        if (info.total !== undefined) progressInfo.total = info.total;
        
        options.onInitProgress!(progressInfo);
      };
    }

    try {
      await this.client.start(startOpts);
    } catch (e) {
      console.error("[KataGoAppAdapter] Failed to start native process:", e);
      const error = new Error("Native KataGo unavailable");
      (error as any).code = "KATAGO_NATIVE_UNAVAILABLE";
      throw error;
    }
    this.initialized = true;
    this.engineInfo = { backend: 'native', modelName: modelPath.split('/').pop() ?? null };
    console.info('[KataGoAppAdapter] Process started successfully, modelName:', this.engineInfo.modelName);
  }

  /**
   * 关闭 KataGo 进程
   */
  async shutdown(): Promise<void> {
    console.info('[KataGoAppAdapter] shutdown() called, initialized:', this.initialized);
    if (!this.initialized) {
      console.info('[KataGoAppAdapter] Already shutdown, skip');
      return;
    }
    await this.client.shutdown();
    this.initialized = false;
    this.engineInfo = { backend: null, modelName: null };
    console.info('[KataGoAppAdapter] Shutdown complete');
  }

  /**
   * 检查进程状态
   */
  private async checkProcessStatus(): Promise<boolean> {
    try {
      return await this.client.status();
    } catch (error) {
      console.error('[KataGoAppAdapter] Failed to check process status:', error);
      return false;
    }
  }

  /**
   * 分析棋局（单局面）
   */
  async analyze(options: AnalyzeOptions): Promise<AnalysisResult> {
    const query = KataGoQueryBuilder.buildSinglePosition(options);
    const results = await this.client.sendQuery(query, 1);
    
    if (results.length === 0) {
      console.error('[KataGoAppAdapter] No analysis result');
      throw new Error('No analysis result');
    }

    return KataGoResultParser.parseSingleAnalysis(results[0]! as unknown as string) as unknown as AnalysisResult;
  }

  /**
   * 整盘批量分析（★ 核心优化）
   */
  async analyzeGame(options: AnalyzeGameOptions): Promise<GameTurnAnalysis[]> {
    const query = KataGoQueryBuilder.buildGameAnalysis(options);
    const expectedTurns = KataGoQueryBuilder.expectedTurnCount(options.analyzeTurns);

    const results = await this.client.sendQuery(query, expectedTurns, options.onResultProgress);
    return KataGoResultParser.parseGameAnalysis(results);
  }

  /**
   * 评估棋局
   */
  async evaluate(options: EvaluateOptions): Promise<any> {
    const moves = options.moveHistory.map(m => {
      const coord = KataGoQueryBuilder.moveToCoord(m as any);
      return {
        player: (m as any).player as 'black' | 'white',
        x: coord.x,
        y: coord.y,
      };
    });

    const gameOpts: AnalyzeGameOptions = {
      moves,
      komi: options.komi,
      maxVisits: 1,
    };

    // 只传 rules 如果有值（避免 exactOptionalPropertyTypes 问题）
    const rules = options.rules as string | undefined;
    if (rules === 'chinese' || rules === 'japanese' || rules === 'korean' || rules === 'tromp-taylor' || rules === 'aga') {
      gameOpts.rules = rules;
    }

    const results = await this.analyzeGame(gameOpts);
    if (results.length === 0) throw new Error('No eval result');

    const root = results[0]!;
    return {
      rootWinRate: root.rootWinRate,
      rootScoreLead: root.rootScoreLead,
      rootScoreSelfplay: root.rootScoreLead,
      rootScoreStdev: 0,
    };
  }

  /**
   * 批量评估棋局
   */
  async evaluateBatch(options: EvaluateBatchOptions): Promise<any[]> {
    const promises = options.positions.map(async (pos) => {
      try {
        const result = await this.evaluate({
          modelUrl: options.modelUrl,
          board: pos.board,
          previousBoard: pos.previousBoard,
          previousPreviousBoard: pos.previousPreviousBoard,
          currentPlayer: pos.currentPlayer,
          moveHistory: pos.moveHistory,
          komi: pos.komi,
          rules: options.rules,
          conservativePass: options.conservativePass,
        });
        return result;
      } catch (e) {
        console.error('[KataGoAppAdapter] evaluateBatch item failed:', e);
        return { rootWinRate: 0.5, rootScoreLead: 0, rootScoreSelfplay: 0, rootScoreStdev: 0 };
      }
    });

    return Promise.all(promises);
  }

  /**
   * 获取引擎信息
   */
  getEngineInfo(): EngineInfo {
    return this.engineInfo;
  }
}

/**
 * 创建 KataGo App 适配器实例（全局单例）
 * @param networkManager - 网络管理器（可选，用于代理下载非同源模型）
 */
let singleton: KataGoAppAdapter | null = null;

export function createKataGoAppAdapter(networkManager?: NetworkManager): KataGoAppAdapter {
  // 如果传入了 NetworkManager，创建新实例
  if (networkManager && singleton) {
    console.info('[KataGoAppAdapter] NetworkManager provided, recreating singleton');
    singleton = new KataGoAppAdapter(networkManager);
  } else if (!singleton) {
    singleton = new KataGoAppAdapter(networkManager);
  }
  return singleton;
}

/**
 * 重置单例（用于测试或强制重新创建）
 */
export function resetKataGoAppAdapter(): void {
  singleton = null;
}
