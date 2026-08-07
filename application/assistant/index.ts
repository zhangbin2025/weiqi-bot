// index.ts - AI 助手核心模块导出
export { AIController } from './AIController';
export { FunctionRegistry } from './FunctionRegistry';
export { IntentProcessor, DEFAULT_ENTITY_DICTS } from './IntentProcessor';
export { TaskOrchestrator } from './TaskOrchestrator';
export { ProgressTracker } from './ProgressTracker';
export { registeredFunctions } from './registeredFunctions';
export { ChatHistoryManager } from './ChatHistoryManager';
export type {
  AIFunction,
  ExecutionContext,
  FunctionDefinition,
  FunctionParameter,
  AIResponse,
  UserIntent,
  AIAction,
  AIActionType,
  IAITask,
  IProgressEvent,
  ISubscription,
  EntityDictionaries,
  IAnalysisService,
} from './types';
export type {
  ChatMessage,
  ChatSessionData,
  ChatSession,
} from './ChatHistoryManager';