/**
 * TaskOrchestrator 测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskOrchestrator } from '../TaskOrchestrator';
import { FunctionRegistry } from '../FunctionRegistry';
import { ProgressTracker } from '../ProgressTracker';
import type { AIFunction } from '../types';
import type { ILogger } from '../../../infrastructure/logger/types';

const createMockLogger = (): ILogger => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  withContext: vi.fn().mockReturnThis(), setLevel: vi.fn(),
  enable: vi.fn(), disable: vi.fn(), getConfig: vi.fn().mockReturnValue({}),
  name: 'test-logger',
});

const logger = createMockLogger();
describe('TaskOrchestrator', () => {
  let registry: FunctionRegistry;
  let progressTracker: ProgressTracker;
  let orchestrator: TaskOrchestrator;
  const immediateFunction: AIFunction = {
    name: 'immediate_task',
    description: '即时任务',
    parameters: {},
    execute: vi.fn().mockResolvedValue({ success: true, data: 'immediate result' }),
  };
  const longRunningFunction: AIFunction = {
    name: 'long_running_task',
    description: '长时间任务',
    parameters: {},
    execute: vi.fn(async (params, context) => {
      context?.onProgress?.(25, '开始处理');
      await new Promise(resolve => setTimeout(resolve, 50));
      context?.onProgress?.(50, '处理中');
      await new Promise(resolve => setTimeout(resolve, 50));
      context?.onProgress?.(100, '完成');
      return { success: true, data: 'long result' };
    }),
    isLongRunning: true,
  };
  const failingFunction: AIFunction = {
    name: 'failing_task',
    description: '会失败的任务',
    parameters: {},
    execute: vi.fn().mockRejectedValue(new Error('任务执行失败')),
  };
  beforeEach(() => {
    registry = new FunctionRegistry(logger);
    registry.registerAll([immediateFunction, longRunningFunction, failingFunction]);
    progressTracker = new ProgressTracker(logger);
    orchestrator = new TaskOrchestrator({ registry, progressTracker, logger });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });
  describe('executeImmediate - 即时任务执行', () => {
    it('应执行即时任务并返回结果', async () => {
      const result = await orchestrator.executeImmediate('immediate_task', {}, 'user-1');
      expect(result).toEqual({ success: true, data: 'immediate result' });
    });
    it('任务状态应变为 completed', async () => {
      await orchestrator.executeImmediate('immediate_task', {}, 'user-1');
      const tasks = orchestrator.getUserTasks('user-1');
      expect(tasks[0].status).toBe('completed');
      expect(tasks[0].result).toEqual({ success: true, data: 'immediate result' });
    });
    it('应记录开始和完成时间', async () => {
      await orchestrator.executeImmediate('immediate_task', {}, 'user-1');
      const task = orchestrator.getUserTasks('user-1')[0];
      expect(task.startedAt).toBeDefined();
      expect(task.completedAt).toBeDefined();
    });
    it('失败任务状态应变为 failed 并记录日志', async () => {
      await expect(
        orchestrator.executeImmediate('failing_task', {}, 'user-1')
      ).rejects.toThrow('任务执行失败');
      const task = orchestrator.getUserTasks('user-1')[0];
      expect(task.status).toBe('failed');
      expect(task.error).toContain('任务执行失败');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Task failed'),
        expect.any(Error)
      );
    });
  });
  describe('executeLongRunning - 长时任务执行', () => {
    it('应立即返回任务对象', () => {
      const task = orchestrator.executeLongRunning('long_running_task', {}, 'user-1');
      expect(task).toBeDefined();
      expect(task.id).toBeDefined();
      expect(task.type).toBe('long-running');
      expect(task.status).toBe('running');
    });
    it('任务应在后台异步执行', async () => {
      const task = orchestrator.executeLongRunning('long_running_task', {}, 'user-1');
      await vi.advanceTimersByTimeAsync(10);
      const runningTask = orchestrator.getTask(task.id);
      expect(runningTask?.status).toBe('running');
    });
    it('任务完成后状态应更新', async () => {
      const task = orchestrator.executeLongRunning('long_running_task', {}, 'user-1');
      await vi.runAllTimersAsync();
      const completedTask = orchestrator.getTask(task.id);
      expect(completedTask?.status).toBe('completed');
      expect(completedTask?.result).toEqual({ success: true, data: 'long result' });
    });
    it('应设置 notifyOnComplete 标志', () => {
      const task = orchestrator.executeLongRunning('long_running_task', {}, 'user-1', true);
      expect(task.notifyOnComplete).toBe(true);
    });
    it('长时任务应记录启动日志', () => {
      orchestrator.executeLongRunning('long_running_task', {}, 'user-1');
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Starting long task')
      );
    });
  });
  describe('cancelTask - 取消任务', () => {
    it('应取消正在运行的任务', async () => {
      const task = orchestrator.executeLongRunning('long_running_task', {}, 'user-1');
      await vi.advanceTimersByTimeAsync(10);
      const result = orchestrator.cancelTask(task.id);
      expect(result).toBe(true);
      expect(orchestrator.getTask(task.id)?.status).toBe('cancelled');
    });
    it('已完成的任务不能取消', async () => {
      await orchestrator.executeImmediate('immediate_task', {}, 'user-1');
      const tasks = orchestrator.getUserTasks('user-1');
      const result = orchestrator.cancelTask(tasks[0].id);
      expect(result).toBe(false);
    });
    it('不存在的任务应返回 false', () => {
      expect(orchestrator.cancelTask('nonexistent-task')).toBe(false);
    });
    it('取消任务应记录日志', async () => {
      const task = orchestrator.executeLongRunning('long_running_task', {}, 'user-1');
      orchestrator.cancelTask(task.id);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Task cancelled')
      );
    });
  });
  describe('getTask - 获取任务', () => {
    it('应返回指定任务', async () => {
      await orchestrator.executeImmediate('immediate_task', { param: 'value' }, 'user-1');
      const tasks = orchestrator.getUserTasks('user-1');
      const task = orchestrator.getTask(tasks[0].id);
      expect(task).toBeDefined();
      expect(task?.intent).toBe('immediate_task');
    });
    it('不存在的任务应返回 undefined', () => {
      expect(orchestrator.getTask('nonexistent')).toBeUndefined();
    });
  });
  describe('getUserTasks - 获取用户任务', () => {
    it('应返回用户的所有任务', async () => {
      await orchestrator.executeImmediate('immediate_task', {}, 'user-1');
      await orchestrator.executeImmediate('immediate_task', {}, 'user-1');
      expect(orchestrator.getUserTasks('user-1')).toHaveLength(2);
    });
    it('应只返回指定用户的任务', async () => {
      await orchestrator.executeImmediate('immediate_task', {}, 'user-1');
      await orchestrator.executeImmediate('immediate_task', {}, 'user-2');
      const tasks = orchestrator.getUserTasks('user-1');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].userId).toBe('user-1');
    });
  });
  describe('getProgressTracker - 获取进度跟踪器', () => {
    it('应返回进度跟踪器实例', () => {
      expect(orchestrator.getProgressTracker()).toBe(progressTracker);
    });
    it('未提供时应创建默认跟踪器', () => {
      const newOrchestrator = new TaskOrchestrator({ registry, logger });
      expect(newOrchestrator.getProgressTracker()).toBeInstanceOf(ProgressTracker);
    });
  });
  describe('回调设置', () => {
    it('setOnTaskComplete 应设置完成回调', async () => {
      const onComplete = vi.fn();
      orchestrator.setOnTaskComplete(onComplete);
      await orchestrator.executeImmediate('immediate_task', {}, 'user-1');
      expect(onComplete).toHaveBeenCalled();
      expect(onComplete.mock.calls[0][0].status).toBe('completed');
    });
    it('setOnTaskFailed 应设置失败回调', async () => {
      const onFailed = vi.fn();
      orchestrator.setOnTaskFailed(onFailed);
      await expect(
        orchestrator.executeImmediate('failing_task', {}, 'user-1')
      ).rejects.toThrow();
      expect(onFailed).toHaveBeenCalled();
    });
    it('setOnProgress 应设置进度回调', async () => {
      const onProgress = vi.fn();
      orchestrator.setOnProgress(onProgress);
      orchestrator.executeLongRunning('long_running_task', {}, 'user-1');
      await vi.runAllTimersAsync();
      expect(onProgress).toHaveBeenCalled();
    });
  });
  describe('进度更新', () => {
    it('应更新任务进度', async () => {
      orchestrator.executeLongRunning('long_running_task', {}, 'user-1');
      await vi.advanceTimersByTimeAsync(100);
      const task = orchestrator.getUserTasks('user-1')[0];
      expect(task.progress).toBeGreaterThan(0);
    });
    it('应通过进度跟踪器报告进度', async () => {
      const reportSpy = vi.spyOn(progressTracker, 'report');
      orchestrator.executeLongRunning('long_running_task', {}, 'user-1');
      await vi.runAllTimersAsync();
      expect(reportSpy).toHaveBeenCalled();
    });
  });
  describe('任务 ID 生成', () => {
    it('任务 ID 应唯一', async () => {
      await orchestrator.executeImmediate('immediate_task', {}, 'user-1');
      await orchestrator.executeImmediate('immediate_task', {}, 'user-1');
      const tasks = orchestrator.getUserTasks('user-1');
      expect(tasks[0].id).not.toBe(tasks[1].id);
    });
    it('任务 ID 应包含时间戳前缀', async () => {
      await orchestrator.executeImmediate('immediate_task', {}, 'user-1');
      const task = orchestrator.getUserTasks('user-1')[0];
      expect(task.id).toMatch(/^task_\d+_/);
    });
  });
});