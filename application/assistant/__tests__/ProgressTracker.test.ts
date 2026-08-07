/**
 * ProgressTracker 测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProgressTracker } from '../ProgressTracker';
import type { IProgressEvent } from '../types';
describe('ProgressTracker', () => {
  let tracker: ProgressTracker;
  let mockLogger: { debug: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    tracker = new ProgressTracker(mockLogger);
  });
  describe('report - 记录进度', () => {
    it('应记录进度事件', () => {
      tracker.report('task-1', 50, '处理中');
      const history = tracker.getHistory('task-1');
      expect(history).toHaveLength(1);
      expect(history[0].progress).toBe(50);
      expect(history[0].message).toBe('处理中');
    });
    it('应记录多个进度事件', () => {
      tracker.report('task-1', 25, '开始');
      tracker.report('task-1', 50, '处理中');
      tracker.report('task-1', 100, '完成');
      const history = tracker.getHistory('task-1');
      expect(history).toHaveLength(3);
      expect(history[0].progress).toBe(25);
      expect(history[1].progress).toBe(50);
      expect(history[2].progress).toBe(100);
    });
    it('进度应限制在 0-100 范围内', () => {
      tracker.report('task-1', -10, '负数');
      tracker.report('task-1', 150, '超限');
      const history = tracker.getHistory('task-1');
      expect(history[0].progress).toBe(0);
      expect(history[1].progress).toBe(100);
    });
    it('应记录时间戳', () => {
      const before = Date.now();
      tracker.report('task-1', 50, '处理中');
      const after = Date.now();
      const history = tracker.getHistory('task-1');
      expect(history[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(history[0].timestamp).toBeLessThanOrEqual(after);
    });
  });
  describe('onProgress - 监听进度', () => {
    it('应通知指定任务的监听者', () => {
      const callback = vi.fn();
      tracker.onProgress('task-1', callback);
      tracker.report('task-1', 50, '处理中');
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].progress).toBe(50);
    });
    it('应通知通配符监听者', () => {
      const callback = vi.fn();
      tracker.onProgress('*', callback);
      tracker.report('task-1', 50, '处理中');
      tracker.report('task-2', 75, '处理中');
      expect(callback).toHaveBeenCalledTimes(2);
    });
    it('不同任务的监听者应独立', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      tracker.onProgress('task-1', callback1);
      tracker.onProgress('task-2', callback2);
      tracker.report('task-1', 50, '处理中');
      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).not.toHaveBeenCalled();
    });
    it('返回的取消函数应移除监听者', () => {
      const callback = vi.fn();
      const unsubscribe = tracker.onProgress('task-1', callback);
      tracker.report('task-1', 25, '开始');
      unsubscribe();
      tracker.report('task-1', 50, '处理中');
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });
  describe('getHistory - 获取进度历史', () => {
    it('应返回所有进度事件', () => {
      tracker.report('task-1', 25, '开始');
      tracker.report('task-1', 50, '处理中');
      tracker.report('task-1', 100, '完成');
      const history = tracker.getHistory('task-1');
      expect(history).toHaveLength(3);
    });
    it('不存在的任务应返回空数组', () => {
      const history = tracker.getHistory('nonexistent');
      expect(history).toEqual([]);
    });
  });
  describe('getLatest - 获取最新进度', () => {
    it('应返回最新的进度事件', () => {
      tracker.report('task-1', 25, '开始');
      tracker.report('task-1', 50, '处理中');
      tracker.report('task-1', 100, '完成');
      const latest = tracker.getLatest('task-1');
      expect(latest?.progress).toBe(100);
      expect(latest?.message).toBe('完成');
    });
    it('不存在的任务应返回 undefined', () => {
      const latest = tracker.getLatest('nonexistent');
      expect(latest).toBeUndefined();
    });
    it('单个事件应正确返回', () => {
      tracker.report('task-1', 50, '处理中');
      const latest = tracker.getLatest('task-1');
      expect(latest?.progress).toBe(50);
    });
  });
  describe('clear - 清除任务进度', () => {
    it('应清除指定任务的进度数据', () => {
      tracker.report('task-1', 50, '处理中');
      tracker.report('task-2', 75, '处理中');
      tracker.clear('task-1');
      expect(tracker.getHistory('task-1')).toEqual([]);
      expect(tracker.getHistory('task-2')).toHaveLength(1);
    });
    it('应清除指定任务的监听者', () => {
      const callback = vi.fn();
      tracker.onProgress('task-1', callback);
      tracker.clear('task-1');
      tracker.report('task-1', 50, '处理中');
      expect(callback).not.toHaveBeenCalled();
    });
  });
  describe('clearAll - 清除所有进度数据', () => {
    it('应清除所有任务进度', () => {
      tracker.report('task-1', 50, '处理中');
      tracker.report('task-2', 75, '处理中');
      tracker.report('task-3', 100, '完成');
      tracker.clearAll();
      expect(tracker.getHistory('task-1')).toEqual([]);
      expect(tracker.getHistory('task-2')).toEqual([]);
      expect(tracker.getHistory('task-3')).toEqual([]);
    });
    it('应清除所有监听者', () => {
      const callback = vi.fn();
      tracker.onProgress('*', callback);
      tracker.clearAll();
      tracker.report('task-1', 50, '处理中');
      expect(callback).not.toHaveBeenCalled();
    });
  });
  describe('多监听者场景', () => {
    it('同一任务可以有多个监听者', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      tracker.onProgress('task-1', callback1);
      tracker.onProgress('task-1', callback2);
      tracker.report('task-1', 50, '处理中');
      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });
    it('可以取消部分监听者', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const unsub1 = tracker.onProgress('task-1', callback1);
      tracker.onProgress('task-1', callback2);
      unsub1();
      tracker.report('task-1', 50, '处理中');
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });
  describe('事件数据完整性', () => {
    it('事件应包含所有必要字段', () => {
      const callback = vi.fn();
      tracker.onProgress('task-1', callback);
      tracker.report('task-1', 50, '处理中');
      const event: IProgressEvent = callback.mock.calls[0][0];
      expect(event.taskId).toBe('task-1');
      expect(event.progress).toBe(50);
      expect(event.message).toBe('处理中');
      expect(event.timestamp).toBeTypeOf('number');
    });
  });
});
