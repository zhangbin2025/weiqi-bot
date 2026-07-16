/** 调度任务 */
export interface IScheduledJob {
  id: string;
  name: string;
  cron: string;                    // cron 表达式
  handler: () => Promise<void>;    // 执行函数
  enabled: boolean;
  lastRun?: number;
  nextRun?: number | undefined;
  createdAt: number;
}

/** 任务队列项 */
export interface IQueueTask {
  id: string;
  name: string;
  handler: () => Promise<void>;
  priority: number;               // 优先级，数字越大越优先
  status: 'pending' | 'running' | 'completed' | 'failed';
  retries: number;
  maxRetries: number;
  createdAt: number;
  startedAt?: number | undefined;
  completedAt?: number;
  error?: string;
}

/** 队列配置 */
export interface ITaskQueueConfig {
  maxConcurrent: number;          // 最大并发数，默认 3
  retryDelay: number;             // 重试延迟 ms，默认 5000
  defaultMaxRetries: number;      // 默认最大重试次数，默认 2
}

/** Scheduler 事件回调 */
export interface ISchedulerCallbacks {
  onJobRun?: (job: IScheduledJob) => void;
  onJobError?: (job: IScheduledJob, error: Error) => void;
}
