/**
 * @fileoverview AI 自对弈服务模块导出
 */

export * from './types';
export * from './IMMPlayService';
export * from './MMPlayService';
export * from './MMStateManager';
export * from './AutoPlayController';

// 从公共 AI 模块重新导出（替代原 AIMoveGenerator）
export { AIController } from '../../ai';
