/**
 * 任务助手 - 提供通用的后台任务处理逻辑
 * @module clients/web/shared/task-helper
 */

import { ScheduleManager } from '../../../domain/schedule';

/**
 * 任务参数
 */
export interface TaskParams {
  scheduleId?: string | null;
  taskId?: string | null;
  view?: string | null;
  favoriteKey?: string | null;
  returnTo?: string | null;
  auto?: string | null;
}

/**
 * 任务处理器（页面实现）
 */
export interface TaskHandlers {
  // 执行周期性任务
  onExecuteSchedule?: (params: any, scheduleId: string) => Promise<void>;
  
  // 查看收藏
  onViewFavorite?: (key: string) => Promise<void>;
}

/**
 * 任务助手类
 */
export class TaskHelper {
  /**
   * 解析任务相关的 URL 参数
   */
  static parseTaskParams(): TaskParams {
    const urlParams = new URLSearchParams(window.location.search);
    
    return {
      scheduleId: urlParams.get('scheduleId'),
      taskId: urlParams.get('taskId'),
      view: urlParams.get('view'),
      favoriteKey: urlParams.get('key'),
      returnTo: urlParams.get('return'),
      auto: urlParams.get('auto'),
    };
  }
  
  /**
   * 处理任务参数（入口函数）
   * 
   * @param params 任务参数
   * @param handlers 任务处理器
   * @returns 是否已处理（如果已处理，页面应终止后续逻辑）
   */
  static async handleTaskParams(
    params: TaskParams,
    handlers: TaskHandlers
  ): Promise<boolean> {
    // 1. 先处理返回参数（优先级最高）
    if (params.returnTo === 'home') {
      this.setupReturnHandler();
    }
    
    // 2. 处理周期性任务
    if (params.scheduleId) {
      await this.handleSchedule(params.scheduleId, handlers);
      return true;
    }
    
    // 3. 处理查看收藏
    if (params.view === 'favorite' && params.favoriteKey) {
      await handlers.onViewFavorite?.(params.favoriteKey);
      return true;
    }
    
    // 4. 返回 false 表示未完全处理，页面应继续执行
    return false;
  }
  
  /**
   * 处理周期性任务
   */
  private static async handleSchedule(
    scheduleId: string,
    handlers: TaskHandlers
  ): Promise<void> {
    console.log('[TaskHelper] Handling schedule:', scheduleId);
    
    // 如果 TaskBridge 不存在，从 URL 参数中提取 params
    if (!window.TaskBridge) {
      console.log('[TaskHelper] TaskBridge not available, extracting params from URL');
      
      // 从 URL 参数中提取业务参数
      const urlParams = new URLSearchParams(window.location.search);
      const params: Record<string, any> = {};
      
      // 提取常见参数
      const paramKeys = ['player', 'limit', 'dateOffset', 'name'];
      for (const key of paramKeys) {
        const value = urlParams.get(key);
        if (value) {
          params[key] = key === 'limit' || key === 'dateOffset' ? parseInt(value, 10) : value;
        }
      }
      
      console.log('[TaskHelper] Extracted params from URL:', params);
      await handlers.onExecuteSchedule?.(params, scheduleId);
      return;
    }
    
    try {
      // 获取计划配置
      const config = await window.TaskBridge.getSchedule(scheduleId);
      
      if (!config) {
        console.error('[TaskHelper] Schedule not found:', scheduleId);
        return;
      }
      
      console.log('[TaskHelper] Schedule config:', config);
      
      // 直接执行任务（判断逻辑已移到底层 TaskWorker）
      console.log('[TaskHelper] Executing schedule...');
      
      await handlers.onExecuteSchedule?.(config.params, scheduleId);
      
      // 注意：不再调用 markAsExecuted + updateSchedule
      // 因为 notifyComplete/markCompleted 已经更新了 lastResult
      // 这里如果再 updateSchedule 会用旧的 config 覆盖掉 lastResult
      
      console.log('[TaskHelper] Schedule executed');
    } catch (error) {
      console.error('[TaskHelper] Failed to handle schedule execution:', error);
    }
  }
  
  /**
   * 设置返回处理器
   */
  private static setupReturnHandler(): void {
    // 插入一个额外记录，增加 history 栈长度，防止直接退出 app
    window.history.pushState({}, '', window.location.href);
    
    // 监听 popstate 事件，直接跳转到助手页面
    window.addEventListener('popstate', () => {
      window.location.href = '/assistant/index.html';
    });
  }
  
  /**
   * 发送任务进度通知
   */
  static notifyProgress(taskId: string | undefined, percent: number, message: string): void {
    if (!taskId) return;
    
    console.log(`[TaskHelper] Sending progress: taskId=${taskId}, percent=${percent}, message=${message}`);
    
    prompt('task:progress:' + JSON.stringify({
      taskId,
      percent,
      message,
    }));
  }
  
  /**
   * 发送任务完成通知
   */
  static async notifyComplete(
    taskId: string | undefined,
    title: string,
    message: string,
    detailUrl: string
  ): Promise<void> {
    if (!taskId) return;
    
    console.log(`[TaskHelper] Sending complete: taskId=${taskId}, title=${title}`);
    
    // 检查是否是周期性任务（通过检查 URL 参数中的 scheduleId）
    const urlParams = new URLSearchParams(window.location.search);
    const scheduleId = urlParams.get('scheduleId');
    
    let finalDetailUrl = detailUrl;
    
    if (scheduleId && scheduleId === taskId) {
      // 周期性任务：更新 scheduleStore 的 lastResult，并修改 detailUrl
      try {
        // 检查 TaskBridge 是否可用
        if (window.TaskBridge) {
          const config = await window.TaskBridge.getSchedule(scheduleId);
          
          if (config) {
            const updatedConfig = ScheduleManager.markAsExecuted(config, {
              status: 'completed',
              title,
              message,
            });
            
            await window.TaskBridge.updateSchedule(scheduleId, updatedConfig);
          } else {
            console.error(`[TaskHelper] Schedule not found: ${scheduleId}`);
          }
        } else {
          // TaskBridge 不可用（隐藏的 GeckoSession），通过 prompt 直接调用
          const configStr = prompt(`task:schedule:get:${scheduleId}`);
          if (configStr) {
            try {
              const config = JSON.parse(configStr);
              if (config && !config.error) {
                const updatedConfig = ScheduleManager.markAsExecuted(config, {
                  status: 'completed',
                  title,
                  message,
                });
                
                // 通过 prompt 调用 schedule:update
                prompt(`task:schedule:update:${JSON.stringify({
                  id: scheduleId,
                  config: updatedConfig,
                })}`);
              } else {
                console.error(`[TaskHelper] Schedule not found via prompt: ${scheduleId}`);
              }
            } catch (e) {
              console.error(`[TaskHelper] Failed to parse schedule config:`, e);
            }
          }
        }
      } catch (error) {
        console.error('[TaskHelper] Failed to update schedule lastResult:', error);
      }
      
      // 修改 detailUrl 为周期性任务的格式
      finalDetailUrl = `/assistant?scheduleId=${scheduleId}`;
    }
    
    prompt('task:complete:' + JSON.stringify({
      taskId,
      title,
      message,
      detailUrl: finalDetailUrl,
    }));
  }
  
  /**
   * 发送任务失败通知
   */
  static notifyFail(taskId: string | undefined, error: string): void {
    if (!taskId) return;
    
    console.log(`[TaskHelper] Sending fail: taskId=${taskId}, error=${error}`);
    
    prompt('task:fail:' + JSON.stringify({
      taskId,
      error,
    }));
  }
}
