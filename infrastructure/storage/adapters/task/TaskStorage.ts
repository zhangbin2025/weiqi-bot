/**
 * 任务持久化存储
 * @description 使用底层存储适配器实现任务和订阅的持久化
 */

import type {
  ITaskStorage,
  ITaskEntity,
  ISubscriptionEntity,
  TaskFilter,
  SubscriptionFilter,
} from './types';

/**
 * 底层存储接口
 * @description 最小化的键值存储接口，支持 get/set 操作
 */
interface IStorage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, data: T): Promise<void>;
}

/**
 * TaskStorage 实现
 * @description 使用底层存储适配器管理任务和订阅数据
 */
export class TaskStorage implements ITaskStorage {
  private storage: IStorage;
  private readonly tasksKey = 'tasks';
  private readonly subscriptionsKey = 'subscriptions';

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  // ==================== 任务相关方法 ====================

  async saveTask(task: ITaskEntity): Promise<void> {
    const tasks = await this.loadAllTasks();
    const index = tasks.findIndex((t) => t.id === task.id);
    if (index >= 0) {
      tasks[index] = task;
    } else {
      tasks.push(task);
    }
    await this.storage.set(this.tasksKey, tasks);
  }

  async loadTask(id: string): Promise<ITaskEntity | null> {
    const tasks = await this.loadAllTasks();
    return tasks.find((t) => t.id === id) ?? null;
  }

  async listTasks(filter?: TaskFilter): Promise<ITaskEntity[]> {
    let tasks = await this.loadAllTasks();

    // 应用过滤条件
    if (filter?.userId) {
      tasks = tasks.filter((t) => t.userId === filter.userId);
    }
    if (filter?.status) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }
    if (filter?.type) {
      tasks = tasks.filter((t) => t.type === filter.type);
    }

    // 应用分页
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? tasks.length;

    return tasks.slice(offset, offset + limit);
  }

  async deleteTask(id: string): Promise<void> {
    const tasks = await this.loadAllTasks();
    const filtered = tasks.filter((t) => t.id !== id);
    await this.storage.set(this.tasksKey, filtered);
  }

  async updateProgress(id: string, progress: number, message: string): Promise<void> {
    const task = await this.loadTask(id);
    if (task) {
      task.progress = progress;
      task.progressMessage = message;
      await this.saveTask(task);
    }
  }

  // ==================== 订阅相关方法 ====================

  async saveSubscription(sub: ISubscriptionEntity): Promise<void> {
    const subs = await this.loadAllSubscriptions();
    const index = subs.findIndex((s) => s.id === sub.id);
    if (index >= 0) {
      subs[index] = sub;
    } else {
      subs.push(sub);
    }
    await this.storage.set(this.subscriptionsKey, subs);
  }

  async loadSubscription(id: string): Promise<ISubscriptionEntity | null> {
    const subs = await this.loadAllSubscriptions();
    return subs.find((s) => s.id === id) ?? null;
  }

  async listSubscriptions(filter?: SubscriptionFilter): Promise<ISubscriptionEntity[]> {
    let subs = await this.loadAllSubscriptions();

    // 应用过滤条件
    if (filter?.userId) {
      subs = subs.filter((s) => s.userId === filter.userId);
    }
    if (filter?.enabled !== undefined) {
      subs = subs.filter((s) => s.enabled === filter.enabled);
    }

    // 应用分页
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? subs.length;

    return subs.slice(offset, offset + limit);
  }

  async deleteSubscription(id: string): Promise<void> {
    const subs = await this.loadAllSubscriptions();
    const filtered = subs.filter((s) => s.id !== id);
    await this.storage.set(this.subscriptionsKey, filtered);
  }

  // ==================== 私有辅助方法 ====================

  private async loadAllTasks(): Promise<ITaskEntity[]> {
    const data = await this.storage.get<ITaskEntity[]>(this.tasksKey);
    return Array.isArray(data) ? data : [];
  }

  private async loadAllSubscriptions(): Promise<ISubscriptionEntity[]> {
    const data = await this.storage.get<ISubscriptionEntity[]>(this.subscriptionsKey);
    return Array.isArray(data) ? data : [];
  }
}
