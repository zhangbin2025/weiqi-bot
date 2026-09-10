/**
 * @fileoverview KataGo RPC 处理器
 * @description 服务端处理器：接收 KataGo RPC 请求，调用本地 IAIEngine 执行
 *
 * 支持的 RPC 方法：
 * - init: 初始化引擎
 * - analyze: 单局面分析
 * - analyzeGame: 整盘批量分析
 * - evaluate: 评估
 * - evaluateBatch: 批量评估
 * - getEngineInfo: 获取引擎信息
 */

import type { IAIEngine, AIEngineInitOptions, AnalyzeOptions, AnalyzeGameOptions, EvaluateOptions, EvaluateBatchOptions, ModelInfo } from '../ai/IAIEngine';
import type { IRpcHandler, TunnelService } from './types';

/** KataGo RPC 请求参数映射 */
interface KatagoRpcParams {
  init: AIEngineInitOptions;
  analyze: AnalyzeOptions;
  analyzeGame: AnalyzeGameOptions;
  evaluate: EvaluateOptions;
  evaluateBatch: EvaluateBatchOptions;
  getEngineInfo: void;
  listModels: void;
}

/** KataGo RPC 方法名 */
type KatagoMethod = keyof KatagoRpcParams;

export class KatagoRpcHandler implements IRpcHandler {
  readonly serviceName: TunnelService = 'katago';
  private engine: IAIEngine;


  constructor(engine: IAIEngine) {
    this.engine = engine;
  }

  /** 更新引擎实例（切换模型时） */
  setEngine(engine: IAIEngine): void {
    this.engine = engine;
  }

  async handle(method: string, params: unknown, onProgress?: (data: unknown) => void): Promise<unknown> {
    const m = method as KatagoMethod;
    switch (m) {
      case 'init': {
        const initOpts = params as AIEngineInitOptions;
        if (onProgress) {
          initOpts.onProgress = (loaded, total, progress) => {
            onProgress({ type: 'download', loaded, total, progress });
          };
          initOpts.onInitProgress = (info) => {
            onProgress({ type: 'init', ...info });
          };
        }
        return this.engine.init(initOpts);
      }

      case 'analyze':
        return this.engine.analyze(params as AnalyzeOptions);

      case 'analyzeGame': {
        const opts = params as AnalyzeGameOptions;
        // 转发进度回调
        const optsWithProgress: AnalyzeGameOptions = {
          ...opts,
          onResultProgress: (current: number, total: number) => {
            onProgress?.({ current, total });
          },
        };
        return this.engine.analyzeGame?.(optsWithProgress);
      }

      case 'evaluate':
        return this.engine.evaluate(params as EvaluateOptions);

      case 'evaluateBatch':
        return this.engine.evaluateBatch(params as EvaluateBatchOptions);

      case 'getEngineInfo':
        return this.engine.getEngineInfo();

      case 'listModels': {
        const models = await this.engine.listModels?.() ?? [];
        // 从 localStorage 读取服务端当前选中的模型
        // ModelManagementService.savePreference 存储在 'weiqi-model:current-model'
        const currentModelId = localStorage.getItem('weiqi-model:current-model');
        const currentFileName = localStorage.getItem('weiqi-model:current-model-filename');
        console.info('[KatagoRpcHandler] listModels: currentModelId=%s, currentFileName=%s', currentModelId, currentFileName);
        if (currentModelId) {
          for (const m of models) {
            // 优先用 modelId 匹配
            if (m.id === currentModelId) {
              m.isCurrent = true;
            } else if (currentFileName) {
              // fallback: 用文件名匹配
              const fileName = m.url?.split('/').pop() ?? ``;
              if (fileName && fileName === currentFileName) {
                m.isCurrent = true;
              }
            }
          }
        }
        return models;
      }

      default:
        throw new Error(`未知的 KataGo 方法: ${method}`);
    }
  }
}
