// infrastructure/config/schemas/TaskConfigSchema.ts

/**
 * 任务配置
 */
export interface ITaskConfig {
  /** 任务存储路径 */
  storagePath: string;

  /** 最大并发任务数 */
  maxConcurrentTasks: number;

  /** 任务保留天数 */
  taskRetentionDays: number;

  /** 失败重试次数 */
  maxRetries: number;

  /** 重试延迟（毫秒） */
  retryDelay: number;

  /** 任务超时（毫秒，0 表示不超时） */
  taskTimeout: number;

  /** 是否持久化任务 */
  persistTasks: boolean;
}

/**
 * 任务配置 Schema（纯类型定义，兼容 zod 接口）
 */
export const TaskConfigSchema = {
  defaultValues: {
    storagePath: './tasks',
    maxConcurrentTasks: 3,
    taskRetentionDays: 7,
    maxRetries: 2,
    retryDelay: 5000,
    taskTimeout: 300000,
    persistTasks: true,
  },
} as const;

export type TaskConfig = ITaskConfig;
