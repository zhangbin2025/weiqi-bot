/**
 * 意图识别模块类型定义
 */

/**
 * 响应类型
 */
export type ResponseType = 'foreground' | 'background' | 'periodic';

/**
 * 意图识别结果
 */
export interface RecognizeResult {
  /** 意图名称 */
  intent: string;
  /** 置信度 (0-1) */
  confidence: number;
  /** 提取的参数 */
  params: Record<string, any>;
  /** 候选意图（置信度接近的） */
  alternatives?: Array<{
    intent: string;
    confidence: number;
  }>;
  /** 匹配的关键词 */
  matchedKeywords?: string[];
  /** 匹配的规则名称 */
  matchedRule?: string;
  /** 响应类型 */
  responseType?: ResponseType;
}

/**
 * 意图配置
 */
export interface IntentConfig {
  /** 意图名称 */
  intent: string;
  /** 页面路径 */
  page: string;
  /** 核心关键词 */
  coreKeywords: string[];
  /** 变体关键词 */
  variantKeywords?: string[];
  /** 是否为后台任务 */
  isLongRunning?: boolean;
  /** 描述 */
  description: string;
}

/**
 * 实体类型
 */
export type EntityType = 'player' | 'count' | 'difficulty' | 'source' | 'url' | 'event' | 'opening';

/**
 * 提取的实体
 */
export interface ExtractedEntity {
  type: EntityType;
  value: any;
  raw: string;
  confidence: number;
}

/**
 * 特殊规则
 */
export interface SpecialRule {
  /** 规则名称 */
  name: string;
  /** 优先级（越高越优先） */
  priority: number;
  /** 匹配函数 */
  match: (text: string) => boolean;
  /** 意图 */
  intent: string;
  /** 参数提取函数 */
  extractParams?: (text: string) => Record<string, any>;
  /** 描述 */
  description: string;
}
