/**
 * @fileoverview KataGo Web 适配器
 * @description 使用 @weiqi/worker 实现 AI 引擎接口（Web 环境）
 */

import { getKataGoEngineClient, KataGoCanceledError, setWorkerUrl } from '@weiqi/worker';
import type { AnalysisResult } from '@weiqi/worker';
import type {
  IAIEngine,
  AIEngineInitOptions,
  AnalyzeOptions,
  EvaluateOptions,
  EvaluateBatchOptions,
  EngineInfo,
} from '../IAIEngine';
import { getWebRoot, toAbsoluteUrl } from '../../utils/web/pathUtils';

/**
 * KataGo Web 适配器
 * @description 在 Web 环境中使用 katago-core 的适配器实现
 */
export class KataGoWebAdapter implements IAIEngine {
  private client = getKataGoEngineClient();

  /**
   * 初始化引擎
   */
  async init(options: AIEngineInitOptions): Promise<void> {
    // 设置 Worker URL（懒加载，避免模块顶层访问 window）
    const workerUrl = toAbsoluteUrl('assets/worker.js');
    setWorkerUrl(workerUrl);
    
    const baseUrl = toAbsoluteUrl('');
    // 默认执行 warm up
    return this.client.init(options.modelUrl, options.onProgress, baseUrl, true);
  }

  /**
   * 分析棋局
   */
  async analyze(options: AnalyzeOptions): Promise<AnalysisResult> {
    return this.client.analyze({
      analysisGroup: options.analysisGroup,
      positionId: options.positionId,
      parentPositionId: options.parentPositionId,
      modelUrl: options.modelUrl,
      board: options.board,
      previousBoard: options.previousBoard,
      previousPreviousBoard: options.previousPreviousBoard,
      currentPlayer: options.currentPlayer,
      moveHistory: options.moveHistory,
      komi: options.komi,
      rules: options.rules,
      regionOfInterest: options.regionOfInterest,
      topK: options.topK,
      analysisPvLen: options.analysisPvLen,
      includeMovesOwnership: options.includeMovesOwnership,
      wideRootNoise: options.wideRootNoise,
      nnRandomize: options.nnRandomize,
      conservativePass: options.conservativePass,
      visits: options.visits,
      maxTimeMs: options.maxTimeMs,
      batchSize: options.batchSize,
      maxChildren: options.maxChildren,
      reportDuringSearchEveryMs: options.reportDuringSearchEveryMs,
      ownershipRefreshIntervalMs: options.ownershipRefreshIntervalMs,
      reuseTree: options.reuseTree,
      ownershipMode: options.ownershipMode,
      onProgress: options.onProgress,
    } as any);
  }

  /**
   * 评估棋局
   */
  async evaluate(options: EvaluateOptions) {
    return this.client.evaluate({
      modelUrl: options.modelUrl,
      board: options.board,
      previousBoard: options.previousBoard,
      previousPreviousBoard: options.previousPreviousBoard,
      currentPlayer: options.currentPlayer,
      moveHistory: options.moveHistory,
      komi: options.komi,
      rules: options.rules,
      conservativePass: options.conservativePass,
    } as any);
  }

  /**
   * 批量评估棋局
   */
  async evaluateBatch(options: EvaluateBatchOptions) {
    return this.client.evaluateBatch({
      modelUrl: options.modelUrl,
      positions: options.positions,
      rules: options.rules,
      conservativePass: options.conservativePass,
    } as any);
  }

  /**
   * 获取引擎信息
   */
  getEngineInfo(): EngineInfo {
    return this.client.getEngineInfo();
  }
}

/**
 * 判断是否为取消错误
 */
export { KataGoCanceledError, isKataGoCanceledError } from '@weiqi/worker';

/**
 * 创建 KataGo Web 适配器实例
 */
export function createKataGoWebAdapter(): KataGoWebAdapter {
  return new KataGoWebAdapter();
}
