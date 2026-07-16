/**
 * LLM 客户端类型定义
 * @description 定义意图识别、实体提取和对话相关的类型
 */

/** 意图识别结果 */
export interface IntentResult {
  /** 意图名称（download_game, start_play, query_player 等） */
  intent: string;
  /** 置信度 0-1 */
  confidence: number;
}

/** 实体提取结果 */
export interface EntityResult {
  /** 实体键值对 */
  entities: Record<string, any>;
}

/** LLM 对话上下文 */
export interface ChatContext {
  /** 对话历史 */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** 当前意图 */
  intent?: string;
}

/** LLM 客户端接口 */
export interface ILLMClient {
  /** 意图分类 */
  classifyIntent(text: string): Promise<IntentResult>;

  /** 实体提取 */
  extractEntities(text: string, intent: string): Promise<EntityResult>;

  /** 对话生成（可选，复杂场景） */
  chat?(message: string, context: ChatContext): Promise<string>;

  /** 检查是否可用 */
  isAvailable(): Promise<boolean>;
}

/** LLM 客户端配置 */
export interface LLMConfig {
  /** 提供商类型 */
  provider: 'onnx' | 'web-onnx' | 'api' | 'local' | 'keyword';
  /** ONNX 模型路径（provider=onnx 或 web-onnx 时必需） */
  modelPath?: string;
  /** API 端点（provider=api 时必需） */
  endpoint?: string;
  /** API 密钥 */
  apiKey?: string;
  /** 超时时间（毫秒） */
  timeout?: number;
}

/** 预定义的意图类型 */
export type IntentType =
  | 'download_game'
  | 'start_play'
  | 'query_player'
  | 'analyze_game'
  | 'start_joseki_quiz'
  | 'explore_joseki'
  | 'discover_joseki'
  | 'analyze_opponent'
  | 'start_review'
  | 'generate_decision'
  | 'start_recorder'
  | 'subscribe_daily_games'
  | 'subscribe_event'
  | 'unknown';
