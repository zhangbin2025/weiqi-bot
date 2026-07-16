/**
 * @fileoverview 人机对弈服务模块导出
 */

// 类型定义
export type {
  Difficulty,
  IHMPlayConfig,
  IHMPlayState,
  IAnalysisResult,
  IMoveAnalysis,
  IHMPlayCallbacks,
} from './types';

// 接口
export type { IHMPlayService } from './IHMPlayService';

// 实现
export { HMPlayService } from './HMPlayService';

// 从公共 AI 模块重新导出（保持向后兼容）
export { AIController, DifficultyManager } from '../../ai';