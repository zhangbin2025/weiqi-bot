/**
 * 任务实体和存储
 * 
 * 对等 Android TaskEntity + TaskStore
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export interface TaskEntity {
  id: string;
  type: string;
  params: string;
  pageUrl: string;
  status: string;
  progress: number;
  progressMessage?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  resultTitle?: string;
  resultMessage?: string;
  resultDetailUrl?: string;
  error?: string;
  scheduleType?: string;
  scheduleInterval?: number;
}

export class TaskStore {
  private file: string;
  private tasks: Map<string, TaskEntity> = new Map();
  private maxAge = 24 * 60 * 60 * 1000; // 1 天

  constructor() {
    const dataDir = path.join(app.getPath('userData'), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.file = path.join(dataDir, 'tasks.json');
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.file)) {
        const content = fs.readFileSync(this.file, 'utf-8');
        const arr = JSON.parse(content);
        for (const task of arr) {
          this.tasks.set(task.id, task);
        }
        console.log(`[TaskStore] Loaded ${this.tasks.size} tasks`);
      }
    } catch (error) {
      console.error('[TaskStore] Failed to load:', error);
    }
  }

  private save() {
    try {
      const arr = Array.from(this.tasks.values());
      fs.writeFileSync(this.file, JSON.stringify(arr, null, 2));
    } catch (error) {
      console.error('[TaskStore] Failed to save:', error);
    }
  }

  async create(data: Partial<TaskEntity>): Promise<TaskEntity> {
    return this.createSync(data);
  }

  createSync(data: Partial<TaskEntity>): TaskEntity {
    const task: TaskEntity = {
      id: data.id || this.generateId(),
      type: data.type || 'unknown',
      params: JSON.stringify(data.params) || '{}',
      pageUrl: data.pageUrl || '',
      status: 'pending',
      progress: 0,
      createdAt: Date.now(),
      scheduleType: data.scheduleType,
      scheduleInterval: data.scheduleInterval,
    };

    this.tasks.set(task.id, task);
    this.save();
    return task;
  }

  get(id: string): TaskEntity | null {
    return this.tasks.get(id) || null;
  }

  list(statuses: string[] = ['pending', 'running']): TaskEntity[] {
    return Array.from(this.tasks.values()).filter(t => statuses.includes(t.status));
  }

  getCompletedTasks(): TaskEntity[] {
    return Array.from(this.tasks.values())
      .filter(t => t.status === 'completed')
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  }

  markRunning(id: string) {
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'running';
      task.startedAt = Date.now();
      this.save();
    }
  }

  updateProgress(id: string, progress: number, message?: string) {
    const task = this.tasks.get(id);
    if (task) {
      task.progress = progress;
      task.progressMessage = message;
      this.save();
    }
  }

  markCompleted(id: string, title?: string, message?: string, detailUrl?: string) {
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'completed';
      task.completedAt = Date.now();
      task.resultTitle = title;
      task.resultMessage = message;
      task.resultDetailUrl = detailUrl;
      this.save();
    }
  }

  markFailed(id: string, error: string) {
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'failed';
      task.completedAt = Date.now();
      task.error = error;
      this.save();
    }
  }

  markCancelled(id: string) {
    const task = this.tasks.get(id);
    if (task) {
      task.status = 'cancelled';
      task.completedAt = Date.now();
      this.save();
    }
  }

  delete(id: string) {
    this.tasks.delete(id);
    this.save();
  }

  cleanup() {
    const threshold = Date.now() - this.maxAge;
    const toDelete = Array.from(this.tasks.values())
      .filter(t => t.createdAt < threshold)
      .map(t => t.id);

    toDelete.forEach(id => this.tasks.delete(id));

    if (toDelete.length > 0) {
      this.save();
      console.log(`[TaskStore] Cleaned up ${toDelete.length} expired tasks`);
    }
  }

  private generateId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }
}
