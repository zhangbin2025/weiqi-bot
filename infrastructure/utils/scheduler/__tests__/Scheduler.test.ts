import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from '../Scheduler';
import { TaskQueue } from '../TaskQueue';

describe('Scheduler', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    scheduler = new Scheduler();
  });

  afterEach(() => {
    scheduler.stop();
  });

  describe('addJob', () => {
    it('should add a job and return id', () => {
      const handler = vi.fn();
      const id = scheduler.addJob({
        id: 'test-job',
        name: 'Test Job',
        cron: '* * * * *',
        handler
      });

      expect(id).toBe('test-job');
      const jobs = scheduler.getJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].enabled).toBe(true);
    });

    it('should generate id if not provided', () => {
      const handler = vi.fn();
      const id = scheduler.addJob({
        name: 'Test Job',
        cron: '* * * * *',
        handler
      });

      expect(id).toBeTruthy();
    });
  });

  describe('removeJob', () => {
    it('should remove a job', () => {
      const handler = vi.fn();
      const id = scheduler.addJob({
        id: 'test-job',
        name: 'Test Job',
        cron: '* * * * *',
        handler
      });

      scheduler.removeJob(id);
      expect(scheduler.getJobs()).toHaveLength(0);
    });
  });

  describe('enableJob/disableJob', () => {
    it('should disable and enable job', () => {
      const handler = vi.fn();
      const id = scheduler.addJob({
        id: 'test-job',
        name: 'Test Job',
        cron: '* * * * *',
        handler
      });

      scheduler.disableJob(id);
      expect(scheduler.getJobs()[0].enabled).toBe(false);

      scheduler.enableJob(id);
      expect(scheduler.getJobs()[0].enabled).toBe(true);
    });
  });

  describe('getNextRun', () => {
    it('should return next run time', () => {
      const nextRun = scheduler.getNextRun('0 * * * *');
      expect(nextRun.getMinutes()).toBe(0);
    });

    it('should find next occurrence for specific time', () => {
      const nextRun = scheduler.getNextRun('30 14 * * *');
      expect(nextRun.getMinutes()).toBe(30);
      expect(nextRun.getHours()).toBe(14);
    });
  });

  describe('cron matching', () => {
    it('should match wildcard *', () => {
      const handler = vi.fn();
      const onJobRun = vi.fn();
      
      scheduler = new Scheduler({ onJobRun });
      scheduler.addJob({
        id: 'test-job',
        name: 'Test Job',
        cron: '* * * * *',
        handler
      });
      
      // 启动后立即检查（可能会触发，取决于当前时间）
      scheduler.start();
    });
  });
});

describe('TaskQueue', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue({ maxConcurrent: 1, retryDelay: 100 });
  });

  describe('enqueue', () => {
    it('should enqueue a task and return id', () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const id = queue.enqueue({
        id: 'test-task',
        name: 'Test Task',
        handler,
        priority: 1,
        maxRetries: 0
      });

      expect(id).toBe('test-task');
    });

    it('should generate id if not provided', () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const id = queue.enqueue({
        name: 'Test Task',
        handler,
        priority: 1,
        maxRetries: 0
      });

      expect(id).toBeTruthy();
    });
  });

  describe('priority', () => {
    it('should execute tasks by priority', async () => {
      const results: number[] = [];
      
      const task1 = () => new Promise<void>(resolve => {
        setTimeout(() => { results.push(1); resolve(); }, 50);
      });
      
      const task2 = () => new Promise<void>(resolve => {
        setTimeout(() => { results.push(2); resolve(); }, 50);
      });

      queue.enqueue({ id: 't1', name: 'Task 1', handler: task1, priority: 1, maxRetries: 0 });
      queue.enqueue({ id: 't2', name: 'Task 2', handler: task2, priority: 2, maxRetries: 0 });
      queue.start();

      // 等待执行完成
      await new Promise(resolve => setTimeout(resolve, 200));

      // 高优先级任务应该先执行
      expect(results).toEqual([2, 1]);
    });
  });

  describe('concurrency', () => {
    it('should limit concurrent tasks', async () => {
      const queue = new TaskQueue({ maxConcurrent: 2, retryDelay: 100 });
      const running: number[] = [];
      let maxConcurrent = 0;
      
      const task = (id: number) => () => new Promise<void>(resolve => {
        running.push(id);
        maxConcurrent = Math.max(maxConcurrent, running.length);
        setTimeout(() => {
          running.splice(running.indexOf(id), 1);
          resolve();
        }, 50);
      });

      queue.enqueue({ id: 't1', name: 'Task 1', handler: task(1), priority: 1, maxRetries: 0 });
      queue.enqueue({ id: 't2', name: 'Task 2', handler: task(2), priority: 1, maxRetries: 0 });
      queue.enqueue({ id: 't3', name: 'Task 3', handler: task(3), priority: 1, maxRetries: 0 });
      queue.enqueue({ id: 't4', name: 'Task 4', handler: task(4), priority: 1, maxRetries: 0 });
      queue.start();

      await new Promise(resolve => setTimeout(resolve, 300));

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });

  describe('retry', () => {
    it('should retry failed tasks', async () => {
      let attempts = 0;
      const handler = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('Failed'));
        }
        return Promise.resolve();
      });

      queue.enqueue({
        id: 'test-task',
        name: 'Test Task',
        handler,
        priority: 1,
        maxRetries: 2
      });
      queue.start();

      await new Promise(resolve => setTimeout(resolve, 500));

      expect(handler).toHaveBeenCalledTimes(3);
      const status = queue.getStatus();
      expect(status.completed).toBe(1);
    });
  });

  describe('getStatus', () => {
    it('should return correct status', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      
      queue.enqueue({ id: 't1', name: 'Task 1', handler, priority: 1, maxRetries: 0 });
      queue.enqueue({ id: 't2', name: 'Task 2', handler, priority: 1, maxRetries: 0 });
      queue.start();

      await new Promise(resolve => setTimeout(resolve, 200));

      const status = queue.getStatus();
      expect(status.completed).toBe(2);
    });
  });

  describe('cancel', () => {
    it('should cancel pending task', () => {
      const handler = vi.fn().mockResolvedValue(undefined);

      queue.enqueue({ id: 't1', name: 'Task 1', handler, priority: 1, maxRetries: 0 });
      queue.enqueue({ id: 't2', name: 'Task 2', handler, priority: 1, maxRetries: 0 });

      const cancelled = queue.cancel('t2');
      expect(cancelled).toBe(true);

      const status = queue.getStatus();
      expect(status.pending).toBe(1);
      expect(status.failed).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('should remove completed tasks', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      
      queue.enqueue({ id: 't1', name: 'Task 1', handler, priority: 1, maxRetries: 0 });
      queue.start();

      await new Promise(resolve => setTimeout(resolve, 100));

      queue.cleanup();

      const status = queue.getStatus();
      expect(status.completed).toBe(0);
    });
  });
});
