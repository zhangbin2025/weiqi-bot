/**
 * TaskBridge - 后台任务桥接
 *
 * 提供前端与原生后台任务系统的桥接接口
 */

import type { TaskOptions, TaskStatus, TaskResult, TaskFilter } from './types'

declare global {
interface Window {
    TaskBridge?: {
      // 提交任务
      submitTask(type: string, params: any, options?: TaskOptions): Promise<string>
      
      // 获取任务状态
      getStatus(taskId: string): Promise<TaskStatus | null>
      
      // 列出任务
      listTasks(filter?: TaskFilter): Promise<TaskStatus[]>
      
      // 获取已完成的任务
      getCompletedTasks(): Promise<TaskStatus[]>
      
      // 删除任务
      deleteTask(taskId: string): Promise<boolean>
      
      // 取消任务
      cancelTask(taskId: string): Promise<boolean>
      
      // 任务完成（业务页面调用）
      complete(taskId: string, result: TaskResult): void
      
      // 任务进度（业务页面调用）
      progress(taskId: string, percent: number, message?: string): void
      
      // 任务失败（业务页面调用）
      fail(taskId: string, error: string): void
      
      // 调度接口
      addSchedule(config: ScheduleConfig): Promise<string>
      updateSchedule(id: string, config: ScheduleConfig): Promise<void>
      deleteSchedule(id: string): Promise<void>
      getSchedule(id: string): Promise<ScheduleConfig | null>
      listSchedules(): Promise<ScheduleConfig[]>
      runScheduleNow(id: string): Promise<void>
    }
  }
}

/**
 * 调度配置（与 domain/schedule/ScheduleConfig 保持一致）
 */
interface ScheduleConfig {
  id: string;
  type: string;
  params: Record<string, any>;
  frequency: 'daily' | 'weekly' | 'monthly';
  hour: number;
  minute: number;
  dayOfWeek?: number | undefined;
  dayOfMonth?: number | undefined;
  enabled: boolean;
  lastRunDate: string | null;
  lastRunTime: number | null;
  pageUrl?: string | undefined;
  lastResult?: {
    status: 'completed' | 'failed';
    title?: string;
    message?: string;
    completedAt: number;
  };
}


/**
 * TaskBridge 实现
 */
export class TaskBridgeImpl {
  /**
   * 提交任务
   */
  async submitTask(type: string, params: any, options?: TaskOptions & { pageUrl?: string }): Promise<string> {
    const request = {
      type,
      params,
      pageUrl: options?.pageUrl || '',
      schedule: options?.schedule
    }
    
    // 通过 prompt 桥接调用 Native
    const message = `task:submit:${JSON.stringify(request)}`
    const response = prompt(message)
    
    if (!response) {
      throw new Error('Failed to submit task: no response')
    }
    
    try {
      const result = JSON.parse(response)
      if (result.error) {
        throw new Error(result.error)
      }
      return result.taskId
    } catch (e) {
      throw new Error(`Failed to parse response: ${response}`)
    }
  }
  
  /**
   * 获取任务状态
   */
  async getStatus(taskId: string): Promise<TaskStatus | null> {
    const message = `task:status:${taskId}`
    const response = prompt(message)
    
    if (!response) {
      return null
    }
    
    try {
      const result = JSON.parse(response)
      if (result.error) {
        return null
      }
      return result as TaskStatus
    } catch (e) {
      return null
    }
  }
  
  /**
   * 列出任务
   */
  async listTasks(filter?: TaskFilter): Promise<TaskStatus[]> {
    const message = `task:list:${JSON.stringify(filter || {})}`
    const response = prompt(message)
    
    if (!response) {
      return []
    }
    
    try {
      const result = JSON.parse(response)
      if (Array.isArray(result)) {
        return result as TaskStatus[]
      }
      return []
    } catch (e) {
      return []
    }
  }
  
  /**
   * 获取已完成的任务
   */
  async getCompletedTasks(): Promise<TaskStatus[]> {
    const message = `task:listCompleted:`
    const response = prompt(message)
    
    if (!response) {
      return []
    }
    
    try {
      const result = JSON.parse(response)
      if (Array.isArray(result)) {
        return result as TaskStatus[]
      }
      return []
    } catch (e) {
      return []
    }
  }
  
  /**
   * 删除任务
   */
  async deleteTask(taskId: string): Promise<boolean> {
    const message = `task:delete:${taskId}`
    const response = prompt(message)
    
    if (!response) {
      return false
    }
    
    try {
      const result = JSON.parse(response)
      return result.success === true
    } catch (e) {
      return false
    }
  }
  
  /**
   * 取消任务
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const message = `task:cancel:${taskId}`
    const response = prompt(message)
    
    if (!response) {
      return false
    }
    
    try {
      const result = JSON.parse(response)
      return result.success === true
    } catch (e) {
      return false
    }
  }
  
  /**
   * 任务完成（业务页面调用）
   */
  complete(taskId: string, result: TaskResult): void {
    const message = `task:complete:${JSON.stringify({
      taskId,
      ...result
    })}`
    prompt(message)
  }
  
  /**
   * 任务进度（业务页面调用）
   */
  progress(taskId: string, percent: number, message?: string): void {
    const msg = `task:progress:${JSON.stringify({
      taskId,
      percent,
      message
    })}`
    prompt(msg)
  }
  
  /**
   * 任务失败（业务页面调用）
   */
  fail(taskId: string, error: string): void {
    const message = `task:fail:${JSON.stringify({
      taskId,
      error
    })}`
    prompt(message)
  }
  
  /**
   * 添加调度
   */
  async addSchedule(config: any): Promise<string> {
    const message = `task:schedule:add:${JSON.stringify(config)}`
    const response = prompt(message)
    
    if (!response) {
      throw new Error('Failed to add schedule: no response')
    }
    
    try {
      const result = JSON.parse(response)
      if (result.error) {
        throw new Error(result.error)
      }
      return result.id
    } catch (e) {
      throw new Error(`Failed to parse response: ${response}`)
    }
  }
  
  /**
   * 更新调度
   */
  async updateSchedule(id: string, config: any): Promise<void> {
    const message = `task:schedule:update:${JSON.stringify({ id, config })}`
    const response = prompt(message)
    
    if (!response) {
      throw new Error('Failed to update schedule: no response')
    }
    
    try {
      const result = JSON.parse(response)
      if (result.error) {
        throw new Error(result.error)
      }
    } catch (e) {
      throw new Error(`Failed to parse response: ${response}`)
    }
  }
  
  /**
   * 删除调度
   */
  async deleteSchedule(id: string): Promise<void> {
    const message = `task:schedule:delete:${id}`
    const response = prompt(message)
    
    if (!response) {
      throw new Error('Failed to delete schedule: no response')
    }
    
    try {
      const result = JSON.parse(response)
      if (result.error) {
        throw new Error(result.error)
      }
    } catch (e) {
      throw new Error(`Failed to parse response: ${response}`)
    }
  }
  
  /**
   * 获取调度
   */
  async getSchedule(id: string): Promise<any | null> {
    const message = `task:schedule:get:${id}`
    const response = prompt(message)
    
    if (!response) {
      return null
    }
    
    try {
      const result = JSON.parse(response)
      if (result.error) {
        return null
      }
      return result
    } catch (e) {
      return null
    }
  }
  
  /**
   * 列出所有调度
   */
  async listSchedules(): Promise<any[]> {
    const message = `task:schedule:list:{}`
    const response = prompt(message)
    
    if (!response) {
      return []
    }
    
    try {
      const result = JSON.parse(response)
      if (Array.isArray(result)) {
        return result
      }
      return []
    } catch (e) {
      return []
    }
  }
  
  /**
   * 立即执行调度
   */
  async runScheduleNow(id: string): Promise<void> {
    const message = `task:schedule:run:${id}`
    const response = prompt(message)
    
    if (!response) {
      throw new Error('Failed to run schedule: no response')
    }
    
    try {
      const result = JSON.parse(response)
      if (result.error) {
        throw new Error(result.error)
      }
    } catch (e) {
      throw new Error(`Failed to parse response: ${response}`)
    }
  }
}

// 初始化 TaskBridge
if (typeof window !== 'undefined') {
  if (!window.TaskBridge) {
    // 纯 Web 环境，创建新的 TaskBridge 实例
    window.TaskBridge = new TaskBridgeImpl();
  } else {
    // Android 环境，扩展已有的 TaskBridge 对象
    const bridge = new TaskBridgeImpl();
    // 添加 Android 端没有的方法
    window.TaskBridge.getCompletedTasks = bridge.getCompletedTasks.bind(bridge);
    window.TaskBridge.deleteTask = bridge.deleteTask.bind(bridge);
    window.TaskBridge.addSchedule = bridge.addSchedule.bind(bridge);
    window.TaskBridge.updateSchedule = bridge.updateSchedule.bind(bridge);
    window.TaskBridge.deleteSchedule = bridge.deleteSchedule.bind(bridge);
    window.TaskBridge.getSchedule = bridge.getSchedule.bind(bridge);
    window.TaskBridge.listSchedules = bridge.listSchedules.bind(bridge);
    window.TaskBridge.runScheduleNow = bridge.runScheduleNow.bind(bridge);
  }
}

export { TaskOptions, TaskStatus, TaskResult, TaskFilter }
