/**
 * 任务存储类型定义
 * @description 定义任务和订阅的数据结构和存储接口
 */

/** 任务状态 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** 任务类型 */
export type TaskType = 'immediate' | 'long-running' | 'scheduled';

/** 任务实体 */
export interface ITaskEntity {
  id: string;
  type: TaskType;
  status: TaskStatus;
  intent: string;
  params: Record<string, any>;
  progress: number;
  progressMessage?: string;
  result?: any;
  error?: string;
  userId: string;
  notifyOnComplete: boolean;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

/** 订阅实体 */
export interface ISubscriptionEntity {
  id: string;
  userId: string;
  functionName: string;
  params: Record<string, any>;
  schedule: string;
  lastRun?: number;
  nextRun?: number;
  enabled: boolean;
  notifyOnComplete: boolean;
  createdAt: number;
}

/** 任务过滤条件 */
export interface TaskFilter {
  userId?: string;
  status?: TaskStatus;
  type?: TaskType;
  limit?: number;
  offset?: number;
}

/** 订阅过滤条件 */
export interface SubscriptionFilter {
  userId?: string;
  enabled?: boolean;
  limit?: number;
  offset?: number;
}

/** 任务存储接口 */
export interface ITaskStorage {
  // 任务 CRUD
  saveTask(task: ITaskEntity): Promise<void>;
  loadTask(id: string): Promise<ITaskEntity | null>;
  listTasks(filter?: TaskFilter): Promise<ITaskEntity[]>;
  deleteTask(id: string): Promise<void>;
  
  // 进度更新
  updateProgress(id: string, progress: number, message: string): Promise<void>;
  
  // 订阅 CRUD
  saveSubscription(sub: ISubscriptionEntity): Promise<void>;
  loadSubscription(id: string): Promise<ISubscriptionEntity | null>;
  listSubscriptions(filter?: SubscriptionFilter): Promise<ISubscriptionEntity[]>;
  deleteSubscription(id: string): Promise<void>;
}
