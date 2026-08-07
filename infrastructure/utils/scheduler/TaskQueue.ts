import { IQueueTask, ITaskQueueConfig } from './types';

export class TaskQueue {
  private queue: IQueueTask[] = [];
  private running: Set<string> = new Set();
  private started = false;
  private config: ITaskQueueConfig = {
    maxConcurrent: 3,
    retryDelay: 5000,
    defaultMaxRetries: 2
  };

  constructor(config?: Partial<ITaskQueueConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  enqueue(task: Omit<IQueueTask, 'status' | 'retries' | 'createdAt'>): string {
    const id = task.id || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.queue.push({
      ...task, id, status: 'pending', retries: 0,
      maxRetries: task.maxRetries ?? this.config.defaultMaxRetries,
      createdAt: Date.now()
    });
    if (this.started) this.processQueue();
    return id;
  }

  start(): void {
    this.started = true;
    this.processQueue();
  }

  stop(): void {
    this.started = false;
  }

  private dequeue(): IQueueTask | undefined {
    const pending = this.queue.filter(t => t.status === 'pending');
    if (pending.length === 0) return undefined;
    pending.sort((a, b) => a.priority !== b.priority ? b.priority - a.priority : a.createdAt - b.createdAt);
    const task = pending[0];
    (task!).status = 'running';
    return task;
  }

  private async executeNext(): Promise<void> {
    if (this.running.size >= this.config.maxConcurrent || !this.started) return;
    const task = this.dequeue();
    if (!task) return;
    
    this.running.add(task.id);
    task.startedAt = Date.now();
    
    try {
      await task.handler();
      task.status = 'completed';
      task.completedAt = Date.now();
    } catch (error) {
      task.error = (error as Error).message;
      if (task.retries < task.maxRetries) {
        task.retries++;
        task.status = 'pending';
        task.startedAt = undefined;
        setTimeout(() => { if (this.started) this.processQueue(); }, this.config.retryDelay);
      } else {
        task.status = 'failed';
        task.completedAt = Date.now();
      }
    } finally {
      this.running.delete(task.id);
      if (this.started) this.processQueue();
    }
  }

  private processQueue(): void {
    while (this.running.size < this.config.maxConcurrent && this.started) {
      const pending = this.queue.filter(t => t.status === 'pending');
      if (pending.length === 0) break;
      this.executeNext();
    }
  }

  getStatus(): { pending: number; running: number; completed: number; failed: number } {
    return {
      pending: this.queue.filter(t => t.status === 'pending').length,
      running: this.running.size,
      completed: this.queue.filter(t => t.status === 'completed').length,
      failed: this.queue.filter(t => t.status === 'failed').length
    };
  }

  cancel(taskId: string): boolean {
    const task = this.queue.find(t => t.id === taskId);
    if (!task || task.status === 'running') return false;
    if (task.status === 'pending') {
      task.status = 'failed';
      task.error = 'Cancelled by user';
      task.completedAt = Date.now();
      return true;
    }
    return false;
  }

  cleanup(): void {
    this.queue = this.queue.filter(t => t.status === 'pending' || t.status === 'running');
  }
}
