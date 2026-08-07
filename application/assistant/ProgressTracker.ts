// ProgressTracker.ts - 任务进度跟踪器
import type { IProgressEvent } from './types';
/**
 * 进度跟踪器
 * 记录任务进度并通知监听者
 */
export class ProgressTracker {
  private events: Map<string, IProgressEvent[]> = new Map();
  private listeners: Map<string, Array<(event: IProgressEvent) => void>> = new Map();
  constructor(logger: ILogger) {
    this.logger = logger;
  }
  /**
   * 记录进度
   */
  report(taskId: string, progress: number, message: string): void {
    const event: IProgressEvent = {
      taskId,
      progress: Math.min(100, Math.max(0, progress)),
      message,
      timestamp: Date.now(),
    };
    if (!this.events.has(taskId)) {
      this.events.set(taskId, []);
    }
    this.events.get(taskId)!.push(event);
    console.debug(`Progress: ${taskId} ${event.progress}% - ${message}`);
    // 通知监听者
    this.listeners.get(taskId)?.forEach(fn => fn(event));
    this.listeners.get('*')?.forEach(fn => fn(event));
  }
  /**
   * 监听任务进度
   * @returns 取消监听的函数
   */
  onProgress(taskId: string, callback: (event: IProgressEvent) => void): () => void {
    if (!this.listeners.has(taskId)) {
      this.listeners.set(taskId, []);
    }
    this.listeners.get(taskId)!.push(callback);
    return () => {
      const arr = this.listeners.get(taskId);
      if (arr) {
        const idx = arr.indexOf(callback);
        if (idx >= 0) arr.splice(idx, 1);
      }
    };
  }
  /**
   * 获取任务进度历史
   */
  getHistory(taskId: string): IProgressEvent[] {
    return this.events.get(taskId) ?? [];
  }
  /**
   * 获取最新进度
   */
  getLatest(taskId: string): IProgressEvent | undefined {
    const history = this.events.get(taskId);
    return history?.[history.length - 1];
  }
  /**
   * 清除任务进度
   */
  clear(taskId: string): void {
    this.events.delete(taskId);
    this.listeners.delete(taskId);
  }
  /**
   * 清除所有进度数据
   */
  clearAll(): void {
    this.events.clear();
    this.listeners.clear();
  }
}