/**
 * 任务管理器
 * 
 * 对等 Android TaskManager
 */

import { BrowserWindow, Notification, shell } from 'electron';
import * as path from 'path';
import { TaskStore, TaskEntity } from './task-store';
import { ScheduleManager } from './schedule-manager';
import { createLogger } from '../utils/logger';

const log = createLogger('TaskManager');

export class TaskManager {
  private store: TaskStore;
  private scheduleManager: ScheduleManager;
  private workers: Map<string, BrowserWindow> = new Map();
  private periodicTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    this.store = new TaskStore();
    this.scheduleManager = new ScheduleManager();
  }

  /**
   * 同步提交任务（立即返回 taskId，后台执行）
   */
  submitSync(
    type: string,
    params: any,
    pageUrl?: string,
    schedule?: any
  ): string {
    const isPeriodic = schedule && schedule.type === 'periodic';
    const taskId = isPeriodic 
      ? schedule.id || this.generateTaskId()
      : this.generateTaskId();

    const finalPageUrl = this.addTaskIdToUrl(pageUrl, taskId);

    if (isPeriodic) {
      this.schedulePeriodic(taskId, schedule);
      this.store.createSync({
        id: taskId,
        type,
        params,
        pageUrl: finalPageUrl,
        scheduleType: 'periodic',
        scheduleInterval: schedule.interval || 15 * 60,
      });
    } else {
      this.store.createSync({
        id: taskId,
        type,
        params,
        pageUrl: finalPageUrl,
        scheduleType: 'immediate',
      });

      // 异步启动隐藏窗口执行任务
      setImmediate(() => this.executeNow(taskId, finalPageUrl, params));
    }

    console.log(`[TaskManager] Submitted task ${taskId}: type=${type}`);
    return taskId;
  }

  /**
   * 同步获取任务状态
   */
  getStatusSync(taskId: string): TaskEntity | null {
    return this.store.get(taskId);
  }

  /**
   * 同步列出任务
   */
  listTasksSync(statuses: string[] = ['pending', 'running']): TaskEntity[] {
    return this.store.list(statuses);
  }

  /**
   * 同步获取已完成任务
   */
  getCompletedTasksSync(): TaskEntity[] {
    return this.store.getCompletedTasks();
  }

  /**
   * 同步删除任务
   */
  deleteTaskSync(taskId: string): void {
    this.cleanupWindow(taskId);
    this.store.delete(taskId);
    console.log(`[TaskManager] Deleted task: ${taskId}`);
  }

  /**
   * 同步取消任务
   */
  cancelTaskSync(taskId: string): boolean {
    const task = this.store.get(taskId);
    if (!task) return false;
    this.cleanupWindow(taskId);
    this.store.markCancelled(taskId);
    console.log(`[TaskManager] Cancelled task: ${taskId}`);
    return true;
  }

  /**
   * 同步更新进度
   */
  updateProgressSync(taskId: string, progress: number, message?: string): void {
    this.store.updateProgress(taskId, progress, message);
  }

  // ========== 调度同步接口 ==========

  addScheduleSync(config: any): string {
    return this.scheduleManager.addSync(config);
  }

  updateScheduleSync(id: string, config: any): void {
    this.scheduleManager.updateSync(id, config);
  }

  deleteScheduleSync(id: string): void {
    // 清理定时器
    if (this.periodicTimers.has(id)) {
      clearInterval(this.periodicTimers.get(id)!);
      this.periodicTimers.delete(id);
      console.log(`[TaskManager] Cleared periodic timer for: ${id}`);
    }
    
    this.cleanupWindow(id);
    this.store.delete(id);
    this.scheduleManager.deleteSync(id);
  }

  getScheduleSync(id: string): any {
    return this.scheduleManager.get(id);
  }

  listSchedulesSync(): any[] {
    return this.scheduleManager.list();
  }

  runScheduleSync(id: string): void {
    const config = this.scheduleManager.get(id);
    if (!config) return;

    // 对齐 Android TaskBridgeHandler schedule:run
    const type = config.type || 'unknown';
    const params = config.params || {};
    
    // 处理 pageUrl（替换占位符）
    let pageUrl = config.pageUrl || '';
    const encodedId = encodeURIComponent(id);
    pageUrl = pageUrl.replace(/__SCHEDULE_ID__/g, encodedId);
    
    // 如果是相对路径，转为完整 URL
    if (pageUrl && !pageUrl.includes('://')) {
      pageUrl = `http://127.0.0.1:8765/${pageUrl.replace(/^\//, '')}`;
    }
    
    // 使用 schedule ID 作为 taskId
    const taskId = id;
    const finalPageUrl = this.addTaskIdToUrl(pageUrl, taskId);
    
    // 立即执行（对齐 Android 调用 submit 后的行为）
    this.store.createSync({
      id: taskId,
      type,
      params,
      pageUrl: finalPageUrl,
      scheduleType: 'periodic',
      scheduleInterval: 15 * 60,
    });
    
    // 调度周期任务
    this.schedulePeriodic(taskId, { interval: 15 });
    
    // 立即执行一次
    setImmediate(() => this.executeNow(taskId, finalPageUrl, params));
  }

  // ========== 原有异步接口（保留兼容） ==========

  /**
   * 提交任务
   */
  async submit(
    type: string,
    params: any,
    pageUrl?: string,
    schedule?: any
  ): Promise<string> {
    const isPeriodic = schedule && schedule.type === 'periodic';
    const taskId = isPeriodic 
      ? schedule.id || this.generateTaskId()
      : this.generateTaskId();

    const finalPageUrl = this.addTaskIdToUrl(pageUrl, taskId);

    if (isPeriodic) {
      // 周期任务：保存并调度
      this.schedulePeriodic(taskId, schedule);
      await this.store.create({
        id: taskId,
        type,
        params,
        pageUrl: finalPageUrl,
        scheduleType: 'periodic',
        scheduleInterval: schedule.interval || 15 * 60,
      });
    } else {
      // 立即任务：在 Worker 中执行
      await this.store.create({
        id: taskId,
        type,
        params,
        pageUrl: finalPageUrl,
        scheduleType: 'immediate',
      });

      this.executeNow(taskId, finalPageUrl, params);
    }

    console.log(`[TaskManager] Submitted task ${taskId}: type=${type}`);
    return taskId;
  }

  /**
   * 立即执行任务
   * 
   * 使用隐藏 BrowserWindow 加载页面，让页面 JS 真正执行
   * 页面通过 TaskHelper.notifyComplete/notifyProgress/notifyFail
   * → prompt('task:complete/progress/fail:...') → IPC → 主进程处理
   */
  private executeNow(taskId: string, pageUrl: string, params: any) {
    // 标记为 running
    this.store.markRunning(taskId);

    // 构建带参数的完整 URL
    let fullUrl = pageUrl;
    if (params && typeof params === 'object') {
      const urlObj = new URL(pageUrl);
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          urlObj.searchParams.set(key, String(value));
        }
      }
      fullUrl = urlObj.toString();
    }

    console.log(`[TaskManager] Creating hidden window for task ${taskId}: ${fullUrl}`);

    // 创建隐藏的 BrowserWindow（对等 Android 隐藏 GeckoSession）
    const taskWindow = new BrowserWindow({
      width: 800,
      height: 600,
      show: false, // 不显示窗口
      webPreferences: {
        preload: path.join(__dirname, '../../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: false, // 与主窗口一致，让 prompt 覆盖生效
        webSecurity: true,
      },
    });

    // 设置 UserAgent，与 Android 对齐
    taskWindow.webContents.setUserAgent('WeiqiApp/1.0');

    this.workers.set(taskId, taskWindow);

    // 超时保护：5 分钟后自动标记失败
    const timeout = setTimeout(() => {
      console.warn(`[TaskManager] Task ${taskId} timed out`);
      this.markFailed(taskId, '任务超时');
      this.cleanupWindow(taskId);
    }, 5 * 60 * 1000);

    // 页面加载完成时检查
    taskWindow.webContents.on('did-finish-load', () => {
      console.log(`[TaskManager] Task page loaded: ${taskId}`);
    });

    // 页面崩溃处理
    taskWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[TaskManager] Task ${taskId} renderer crashed:`, details);
      clearTimeout(timeout);
      this.markFailed(taskId, `页面崩溃: ${details.reason}`);
      this.cleanupWindow(taskId);
    });

    // 窗口关闭时清理
    taskWindow.on('closed', () => {
      clearTimeout(timeout);
      this.workers.delete(taskId);
    });

    // 加载任务页面 — 页面 JS 会通过 prompt() 回调 IPC
    taskWindow.loadURL(fullUrl).catch((err) => {
      console.error(`[TaskManager] Failed to load task page ${taskId}:`, err);
      clearTimeout(timeout);
      this.markFailed(taskId, `加载页面失败: ${err.message}`);
      this.cleanupWindow(taskId);
    });
  }

  /**
   * 清理隐藏窗口
   */
  private cleanupWindow(taskId: string) {
    const win = this.workers.get(taskId);
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
    this.workers.delete(taskId);
  }

  /**
   * 调度周期任务（对齐 Android schedulePeriodic）
   */
  private schedulePeriodic(taskId: string, schedule: any) {
    // 保存定时器引用，避免重复调度
    if (this.periodicTimers && this.periodicTimers.has(taskId)) {
      clearInterval(this.periodicTimers.get(taskId)!);
    }
    
    if (!this.periodicTimers) {
      this.periodicTimers = new Map<string, NodeJS.Timeout>();
    }
    
    const intervalMinutes = schedule.interval || 15;
    const intervalMs = intervalMinutes * 60 * 1000;
    
    console.log(`[TaskManager] Scheduling periodic task ${taskId}: interval=${intervalMinutes}min`);
    
    const timer = setInterval(() => {
      const config = this.scheduleManager.get(taskId);
      if (!config) {
        console.log(`[TaskManager] Schedule config not found: ${taskId}`);
        return;
      }
      
      // 处理 pageUrl（替换占位符）
      let pageUrl = config.pageUrl || '';
      const encodedId = encodeURIComponent(taskId);
      pageUrl = pageUrl.replace(/__SCHEDULE_ID__/g, encodedId);
      
      // 如果是相对路径，转为完整 URL
      if (pageUrl && !pageUrl.includes('://')) {
        pageUrl = `http://127.0.0.1:8765/${pageUrl.replace(/^\//, '')}`;
      }
      
      const params = config.params || {};
      const finalPageUrl = this.addTaskIdToUrl(pageUrl, taskId);
      
      console.log(`[TaskManager] Executing periodic task ${taskId}`);
      this.executeNow(taskId, finalPageUrl, params);
    }, intervalMs);
    
    this.periodicTimers.set(taskId, timer);
  }

  /**
   * 判断是否需要执行（对等 Android TaskWorker.shouldExecute）
   */
  private shouldExecute(config: any): boolean {
    // 简化实现：检查上次执行时间
    const lastRun = config.lastRun;
    if (!lastRun) return true;

    const now = Date.now();
    const frequency = config.frequency || 'daily';
    const hour = config.hour || 0;

    // 检查当前小时
    const currentHour = new Date().getHours();
    if (currentHour !== hour) return false;

    // 检查是否跨周期
    const lastDate = new Date(lastRun).toDateString();
    const today = new Date().toDateString();

    switch (frequency) {
      case 'daily':
        return lastDate !== today;
      case 'weekly':
        const lastWeek = this.getWeekNumber(new Date(lastRun));
        const currentWeek = this.getWeekNumber(new Date());
        return lastWeek !== currentWeek;
      case 'monthly':
        const lastMonth = new Date(lastRun).getMonth();
        const currentMonth = new Date().getMonth();
        return lastMonth !== currentMonth;
      default:
        return false;
    }
  }

  private getWeekNumber(date: Date): number {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  /**
   * 获取任务状态
   */
  async getStatus(taskId: string): Promise<TaskEntity | null> {
    return this.store.get(taskId);
  }

  /**
   * 列出任务
   */
  async listTasks(statuses: string[] = ['pending', 'running']): Promise<TaskEntity[]> {
    return this.store.list(statuses);
  }

  /**
   * 获取已完成任务
   */
  async getCompletedTasks(): Promise<TaskEntity[]> {
    return this.store.getCompletedTasks();
  }

  /**
   * 删除任务
   */
  async deleteTask(taskId: string): Promise<void> {
    // 停止隐藏窗口（如果在运行）
    this.cleanupWindow(taskId);

    await this.store.delete(taskId);
    console.log(`[TaskManager] Deleted task: ${taskId}`);
  }

  /**
   * 取消任务
   */
  async cancelTask(taskId: string): Promise<boolean> {
    this.cleanupWindow(taskId);

    await this.store.markCancelled(taskId);
    console.log(`[TaskManager] Cancelled task: ${taskId}`);
    return true;
  }

  /**
   * 标记完成（public，允许外部调用）
   */
  markCompleted(taskId: string, title?: string, message?: string, detailUrl?: string) {
    this.store.markCompleted(taskId, title, message, detailUrl);
    
    // 如果 taskId 对应一个 schedule，更新 schedule 的 lastResult
    // 这是底层保障，不依赖前端 JS 的 notifyComplete 来更新
    const scheduleConfig = this.scheduleManager.get(taskId);
    if (scheduleConfig) {
      const now = Date.now();
      scheduleConfig.lastResult = {
        status: 'completed',
        title: title || '',
        message: message || '',
        completedAt: now,
      };
      scheduleConfig.lastRunDate = new Date(now).toISOString().split('T')[0];
      scheduleConfig.lastRunTime = now;
      this.scheduleManager.updateSync(taskId, scheduleConfig);
      log.info(`Task ${taskId} schedule lastResult updated`);
    }
    
    // 解析 Markdown 链接：提取文字和 URL
    let displayMessage = message || '';
    let linkUrl = detailUrl || '';
    
    // 匹配 [文字](URL) 格式
    const linkMatch = displayMessage.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      const linkText = linkMatch[1];
      const linkHref = linkMatch[2];
      // 替换 Markdown 链接为纯文本
      displayMessage = displayMessage.replace(linkMatch[0], linkText);
      // 如果没有 detailUrl，使用 message 中的链接
      if (!linkUrl) {
        linkUrl = linkHref;
      }
    }
    
    // 发送系统通知
    const notification = new Notification({
      title: title || '任务完成',
      body: displayMessage,
    });
    
    // 点击通知 -> 聚焦窗口并导航到结果页面
    notification.on('click', () => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window) {
        window.focus();
        if (linkUrl) {
          // 构建完整 URL
          let fullUrl = linkUrl;
          if (!linkUrl.startsWith('http://') && !linkUrl.startsWith('https://')) {
            fullUrl = `http://127.0.0.1:8765${linkUrl.startsWith('/') ? '' : '/'}${linkUrl}`;
          }

          const isLocalAsset = fullUrl.includes('127.0.0.1:8765') || fullUrl.includes('localhost:8765');
          if (isLocalAsset) {
            // 本地页面：通过前端路由导航
            // 用 webContents.send 通知前端路由，避免 loadURL 整页刷新
            try {
              const urlObj = new URL(fullUrl);
              const route = urlObj.pathname + urlObj.search + urlObj.hash;
              window.webContents.send('navigate', route);
            } catch {
              // fallback: 直接 loadURL
              window.webContents.loadURL(fullUrl);
            }
          } else {
            // 非本地 URL -> 用默认浏览器打开
            shell.openExternal(linkUrl);
          }
        }
      }
    });
    
    notification.show();

    // 任务完成后延迟关闭隐藏窗口
    // IndexedDB 写入是异步的，需要给足够时间 flush 到磁盘
    // 否则后台任务保存的数据可能丢失
    setTimeout(() => this.cleanupWindow(taskId), 2000);

    log.info(`Task ${taskId} completed: ${title}`);
  }

  /**
   * 标记失败（public，允许外部调用）
   */
  markFailed(taskId: string, error: string) {
    this.store.markFailed(taskId, error);
    
    // 如果 taskId 对应一个 schedule，更新 schedule 的 lastResult
    const scheduleConfig = this.scheduleManager.get(taskId);
    if (scheduleConfig) {
      const now = Date.now();
      scheduleConfig.lastResult = {
        status: 'failed',
        title: '任务失败',
        message: error,
        completedAt: now,
      };
      scheduleConfig.lastRunDate = new Date(now).toISOString().split('T')[0];
      scheduleConfig.lastRunTime = now;
      this.scheduleManager.updateSync(taskId, scheduleConfig);
      log.info(`Task ${taskId} schedule lastResult updated (failed)`);
    }
    
    new Notification({
      title: '任务失败',
      body: error,
    }).show();

    // 任务失败后关闭隐藏窗口（延迟到下一个 tick）
    setImmediate(() => this.cleanupWindow(taskId));

    log.info(`Task ${taskId} failed: ${error}`);
  }

  // ========== 调度相关接口 ==========

  async addSchedule(config: any): Promise<string> {
    return this.scheduleManager.add(config);
  }

  async updateSchedule(id: string, config: any): Promise<void> {
    return this.scheduleManager.update(id, config);
  }

  async deleteSchedule(id: string): Promise<void> {
    // 取消正在运行的任务
    this.cleanupWindow(id);

    await this.store.delete(id);
    await this.scheduleManager.delete(id);
  }

  async getSchedule(id: string): Promise<any> {
    return this.scheduleManager.get(id);
  }

  async listSchedules(): Promise<any[]> {
    return this.scheduleManager.list();
  }

  async runSchedule(id: string): Promise<void> {
    const config = this.scheduleManager.get(id);
    if (!config) return;

    const pageUrl = config.pageUrl;
    const params = config.params || {};
    const type = config.type || 'unknown';

    await this.submit(type, params, pageUrl, { id, type: 'periodic' });
  }

  // ========== 辅助方法 ==========

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }

  private addTaskIdToUrl(url?: string, taskId?: string): string {
    if (!url) {
      return `http://127.0.0.1:8765/index.html?taskId=${taskId}`;
    }

    if (url.includes('taskId=')) {
      return url;
    }

    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}taskId=${taskId}`;
  }
}
