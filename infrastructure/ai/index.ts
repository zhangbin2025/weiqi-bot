/**
 * @fileoverview AI 模块主入口
 * @description 导出 AI 引擎接口和适配器
 *
 * 注意：适配器（KataGoWebAdapter/KataGoAppAdapter/KataGoRemoteAdapter）
 * 不在此处静态导出，避免拉入浏览器/原生依赖。
 * 如需使用，直接 from './adapters/KataGoXxxAdapter' 动态 require。
 */

// 导出接口
export type {
  IAIEngine,
  AIEngineInitOptions,
  AnalyzeOptions,
  EvaluateOptions,
  EvaluateBatchOptions,
  EngineInfo,
  AnalyzeGameOptions,
  GameTurnAnalysis,
  ModelInfo,
} from './IAIEngine';

// 导出引擎工厂
export {
  createAIEngine,
  isAppEnvironment,
  resetAIEngine,
  forceUseWebAdapter,
} from './createAIEngine';
