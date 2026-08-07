/**
 * TaskStorage 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskStorage } from '../TaskStorage';
import type { ITaskEntity, ISubscriptionEntity } from '../types';

/**
 * 模拟存储适配器
 */
class MockStorage {
  private data = new Map<string, any>();

  async get<T>(key: string): Promise<T | null> {
    return this.data.get(key) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }

  clear() {
    this.data.clear();
  }
}

describe('TaskStorage', () => {
  let storage: MockStorage;
  let taskStorage: TaskStorage;

  beforeEach(() => {
    storage = new MockStorage();
    taskStorage = new TaskStorage(storage);
  });

  describe('任务 CRUD', () => {
    it('应该能够保存和加载任务', async () => {
      const task: ITaskEntity = {
        id: 'task-1',
        type: 'immediate',
        status: 'pending',
        intent: '查询天气',
        params: { city: '北京' },
        progress: 0,
        userId: 'user-1',
        notifyOnComplete: true,
        createdAt: Date.now(),
      };

      await taskStorage.saveTask(task);
      const loaded = await taskStorage.loadTask('task-1');

      expect(loaded).toEqual(task);
    });

    it('应该能够更新已存在的任务', async () => {
      const task: ITaskEntity = {
        id: 'task-1',
        type: 'immediate',
        status: 'pending',
        intent: '查询天气',
        params: { city: '北京' },
        progress: 0,
        userId: 'user-1',
        notifyOnComplete: true,
        createdAt: Date.now(),
      };

      await taskStorage.saveTask(task);

      task.status = 'running';
      task.progress = 50;
      await taskStorage.saveTask(task);

      const loaded = await taskStorage.loadTask('task-1');
      expect(loaded?.status).toBe('running');
      expect(loaded?.progress).toBe(50);
    });

    it('应该能够列出所有任务', async () => {
      const tasks: ITaskEntity[] = [
        {
          id: 'task-1',
          type: 'immediate',
          status: 'pending',
          intent: '查询天气',
          params: {},
          progress: 0,
          userId: 'user-1',
          notifyOnComplete: true,
          createdAt: Date.now(),
        },
        {
          id: 'task-2',
          type: 'long-running',
          status: 'running',
          intent: '数据分析',
          params: {},
          progress: 30,
          userId: 'user-2',
          notifyOnComplete: false,
          createdAt: Date.now(),
        },
      ];

      for (const task of tasks) {
        await taskStorage.saveTask(task);
      }

      const list = await taskStorage.listTasks();
      expect(list).toHaveLength(2);
    });

    it('应该能够按用户过滤任务', async () => {
      const tasks: ITaskEntity[] = [
        {
          id: 'task-1',
          type: 'immediate',
          status: 'pending',
          intent: '查询天气',
          params: {},
          progress: 0,
          userId: 'user-1',
          notifyOnComplete: true,
          createdAt: Date.now(),
        },
        {
          id: 'task-2',
          type: 'long-running',
          status: 'running',
          intent: '数据分析',
          params: {},
          progress: 30,
          userId: 'user-2',
          notifyOnComplete: false,
          createdAt: Date.now(),
        },
      ];

      for (const task of tasks) {
        await taskStorage.saveTask(task);
      }

      const list = await taskStorage.listTasks({ userId: 'user-1' });
      expect(list).toHaveLength(1);
      expect(list[0].userId).toBe('user-1');
    });

    it('应该能够按状态过滤任务', async () => {
      const tasks: ITaskEntity[] = [
        {
          id: 'task-1',
          type: 'immediate',
          status: 'pending',
          intent: '查询天气',
          params: {},
          progress: 0,
          userId: 'user-1',
          notifyOnComplete: true,
          createdAt: Date.now(),
        },
        {
          id: 'task-2',
          type: 'long-running',
          status: 'running',
          intent: '数据分析',
          params: {},
          progress: 30,
          userId: 'user-2',
          notifyOnComplete: false,
          createdAt: Date.now(),
        },
      ];

      for (const task of tasks) {
        await taskStorage.saveTask(task);
      }

      const list = await taskStorage.listTasks({ status: 'running' });
      expect(list).toHaveLength(1);
      expect(list[0].status).toBe('running');
    });

    it('应该能够分页查询任务', async () => {
      for (let i = 1; i <= 5; i++) {
        const task: ITaskEntity = {
          id: `task-${i}`,
          type: 'immediate',
          status: 'pending',
          intent: `任务${i}`,
          params: {},
          progress: 0,
          userId: 'user-1',
          notifyOnComplete: true,
          createdAt: Date.now(),
        };
        await taskStorage.saveTask(task);
      }

      const page1 = await taskStorage.listTasks({ limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);

      const page2 = await taskStorage.listTasks({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);

      const page3 = await taskStorage.listTasks({ limit: 2, offset: 4 });
      expect(page3).toHaveLength(1);
    });

    it('应该能够删除任务', async () => {
      const task: ITaskEntity = {
        id: 'task-1',
        type: 'immediate',
        status: 'pending',
        intent: '查询天气',
        params: {},
        progress: 0,
        userId: 'user-1',
        notifyOnComplete: true,
        createdAt: Date.now(),
      };

      await taskStorage.saveTask(task);
      await taskStorage.deleteTask('task-1');

      const loaded = await taskStorage.loadTask('task-1');
      expect(loaded).toBeNull();
    });
  });

  describe('进度更新', () => {
    it('应该能够更新任务进度', async () => {
      const task: ITaskEntity = {
        id: 'task-1',
        type: 'long-running',
        status: 'running',
        intent: '数据分析',
        params: {},
        progress: 0,
        userId: 'user-1',
        notifyOnComplete: true,
        createdAt: Date.now(),
      };

      await taskStorage.saveTask(task);
      await taskStorage.updateProgress('task-1', 50, '处理中');

      const loaded = await taskStorage.loadTask('task-1');
      expect(loaded?.progress).toBe(50);
      expect(loaded?.progressMessage).toBe('处理中');
    });

    it('更新不存在的任务应该无操作', async () => {
      await taskStorage.updateProgress('non-existent', 50, '处理中');
      const loaded = await taskStorage.loadTask('non-existent');
      expect(loaded).toBeNull();
    });
  });

  describe('订阅 CRUD', () => {
    it('应该能够保存和加载订阅', async () => {
      const sub: ISubscriptionEntity = {
        id: 'sub-1',
        userId: 'user-1',
        functionName: 'getWeather',
        params: { city: '北京' },
        schedule: '0 9 * * *',
        enabled: true,
        notifyOnComplete: true,
        createdAt: Date.now(),
      };

      await taskStorage.saveSubscription(sub);
      const loaded = await taskStorage.loadSubscription('sub-1');

      expect(loaded).toEqual(sub);
    });

    it('应该能够列出用户的所有订阅', async () => {
      const subs: ISubscriptionEntity[] = [
        {
          id: 'sub-1',
          userId: 'user-1',
          functionName: 'getWeather',
          params: {},
          schedule: '0 9 * * *',
          enabled: true,
          notifyOnComplete: true,
          createdAt: Date.now(),
        },
        {
          id: 'sub-2',
          userId: 'user-1',
          functionName: 'getNews',
          params: {},
          schedule: '0 10 * * *',
          enabled: true,
          notifyOnComplete: false,
          createdAt: Date.now(),
        },
        {
          id: 'sub-3',
          userId: 'user-2',
          functionName: 'getWeather',
          params: {},
          schedule: '0 9 * * *',
          enabled: true,
          notifyOnComplete: true,
          createdAt: Date.now(),
        },
      ];

      for (const sub of subs) {
        await taskStorage.saveSubscription(sub);
      }

      const list = await taskStorage.listSubscriptions({ userId: 'user-1' });
      expect(list).toHaveLength(2);
    });

    it('应该能够删除订阅', async () => {
      const sub: ISubscriptionEntity = {
        id: 'sub-1',
        userId: 'user-1',
        functionName: 'getWeather',
        params: {},
        schedule: '0 9 * * *',
        enabled: true,
        notifyOnComplete: true,
        createdAt: Date.now(),
      };

      await taskStorage.saveSubscription(sub);
      await taskStorage.deleteSubscription('sub-1');

      const loaded = await taskStorage.loadSubscription('sub-1');
      expect(loaded).toBeNull();
    });
  });

  describe('边缘情况', () => {
    it('加载不存在的任务应该返回 null', async () => {
      const loaded = await taskStorage.loadTask('non-existent');
      expect(loaded).toBeNull();
    });

    it('加载不存在的订阅应该返回 null', async () => {
      const loaded = await taskStorage.loadSubscription('non-existent');
      expect(loaded).toBeNull();
    });

    it('空存储应该返回空数组', async () => {
      const tasks = await taskStorage.listTasks();
      expect(tasks).toEqual([]);

      const subs = await taskStorage.listSubscriptions();
      expect(subs).toEqual([]);
    });
  });
});
