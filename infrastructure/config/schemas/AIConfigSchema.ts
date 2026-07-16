// infrastructure/config/schemas/AIConfigSchema.ts

/**
 * LLM 提供者类型
 */
export type LLMProvider = 'onnx' | 'api' | 'hybrid';

/**
 * AI 助手配置
 */
export interface IAIConfig {
  /** LLM 提供者 */
  llmProvider: LLMProvider;

  /** ONNX 模型路径 */
  onnxModelPath?: string;

  /** API 端点（远程 LLM） */
  apiEndpoint?: string;

  /** API 密钥 */
  apiKey?: string;

  /** 自动执行阈值（置信度 ≥ 此值直接执行） */
  autoExecuteThreshold: number;

  /** 确认阈值（置信度 ≥ 此值需确认） */
  confirmThreshold: number;

  /** 是否启用 AI 助手 */
  enabled: boolean;
}

/**
 * AI 配置 Schema（纯类型定义，兼容 zod 接口）
 */
export const AIConfigSchema = {
  defaultValues: {
    llmProvider: 'onnx' as const,
    autoExecuteThreshold: 0.8,
    confirmThreshold: 0.5,
    enabled: true,
  },
} as const;

export type AIConfig = IAIConfig;
