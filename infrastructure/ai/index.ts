/**
 * @fileoverview AI 模块主入口
 * @description 导出 AI 引擎接口和适配器
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
} from './IAIEngine';

// 导出 Web 适配器
export { 
  KataGoWebAdapter, 
  createKataGoWebAdapter,
  KataGoCanceledError,
  isKataGoCanceledError,
} from './adapters/KataGoWebAdapter';

// 导出 App 适配器
export {
  KataGoAppAdapter,
  createKataGoAppAdapter,
} from './adapters/KataGoAppAdapter';

// 导出引擎工厂
export {
  createAIEngine,
  isAppEnvironment,
  resetAIEngine,
  forceUseWebAdapter,
} from './createAIEngine';
