// TaskOrchestrator.ts - 任务编排器
import { FunctionRegistry } from './FunctionRegistry';
import { ProgressTracker } from './ProgressTracker';
import type { IAITask, IProgressEvent } from './types';
import type { ILogger } from '../../infrastructure/logger/types';
/** 任务编排器配置 */
export interface TaskOrchestratorConfig {
  registry: FunctionRegistry;
  progressTracker?: ProgressTracker;
  logger: ILogger;
}
/**
 * 任务编排器
 * 管理即时任务和长时任务的执行
 */
export class TaskOrchestrator {
  private tasks: Map<string, IAITask> = new Map();
  private progressTracker: ProgressTracker;
  private registry: FunctionRegistry;
  private logger: ILogger;
  private onTaskComplete?: (task: IAITask) => void;
  private onTaskFailed?: (task: IAITask, error: Error) => void;
  private onProgress?: (event: IProgressEvent) => void;

  constructor(config: TaskOrchestratorConfig) {
    this.registry = config.registry;
    this.progressTracker = config.progressTracker ?? new ProgressTracker();
    this.logger = config.logger;
  }
  setOnTaskComplete(callback: (task: IAITask) => void): void {
    this.onTaskComplete = callback;
  }
  setOnTaskFailed(callback: (task: IAITask, error: Error) => void): void {
    this.onTaskFailed = callback;
  }
  setOnProgress(callback: (event: IProgressEvent) => void): void {
    this.onProgress = callback;
  }
  async executeImmediate(intent: string, params: any, userId: string): Promise<any> {
    const task = this.createTask('immediate', intent, params, userId);
    task.status = 'running';
    task.startedAt = Date.now();
    try {
      const result = await this.registry.execute(intent, params, {
        userId,
        taskId: task.id,
        logger: this.logger,
        onProgress: (p: number, msg: string) => this.updateProgress(task.id, p, msg),
      } as any);
      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();
      this.logger.info(`Task completed: ${task.id}`);
      this.onTaskComplete?.(task);
      return result;
    } catch (error) {
      task.status = 'failed';
      task.error = String(error);
      task.completedAt = Date.now();
      this.logger.error(`Task failed: ${task.id}`, error as Error);
      this.onTaskFailed?.(task, error as Error);
      throw error;
    }
  }
  executeLongRunning(intent: string, params: any, userId: string, notifyOnComplete = false): IAITask {
    const task = this.createTask('long-running', intent, params, userId);
    task.notifyOnComplete = notifyOnComplete;
    this.logger.info(`Starting long task: ${task.id}`);
    this.runLongTask(task).catch(() => { /* handled in runLongTask */ });
    return task;
  }
  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'completed' || task.status === 'failed') {
      return false;
    }
    task.status = 'cancelled';
    task.completedAt = Date.now();
    this.logger.info(`Task cancelled: ${taskId}`);
    return true;
  }
  getTask(taskId: string): IAITask | undefined {
    return this.tasks.get(taskId);
  }
  getUserTasks(userId: string): IAITask[] {
    return Array.from(this.tasks.values()).filter(t => t.userId === userId);
  }
  getProgressTracker(): ProgressTracker {
    return this.progressTracker;
  }
  private createTask(type: IAITask['type'], intent: string, params: any, userId: string): IAITask {
    const task: IAITask = {
      id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      type,
      status: 'pending',
      intent,
      params,
      progress: 0,
      createdAt: Date.now(),
      userId,
      notifyOnComplete: false,
    };
    this.tasks.set(task.id, task);
    return task;
  }
  private updateProgress(taskId: string, progress: number, message: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.progress = progress;
      task.progressMessage = message;
    }
    this.progressTracker.report(taskId, progress, message);
    const event: IProgressEvent = { taskId, progress, message, timestamp: Date.now() };
    this.onProgress?.(event);
  }
  private async runLongTask(task: IAITask): Promise<void> {
    task.status = 'running';
    task.startedAt = Date.now();
    console.info(`Starting long task: ${task.id} (${task.intent})`);
    try {
      const result = await this.registry.execute(task.intent, task.params, {
        userId: task.userId,
        taskId: task.id,
        logger: this.logger,
        onProgress: (p: number, msg: string) => this.updateProgress(task.id, p, msg),
      } as any);
      if ((task.status as string) === 'cancelled') return;
      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();
      console.info(`Task completed: ${task.id}`);
      this.onTaskComplete?.(task);
    } catch (error) {
      if ((task.status as string) === 'cancelled') return;
      task.status = 'failed';
      task.error = String(error);
      task.completedAt = Date.now();
      console.error(`Task failed: ${task.id}`, error as Error);
      this.onTaskFailed?.(task, error as Error);
    }
  }
}