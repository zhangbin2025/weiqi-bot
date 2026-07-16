/**
 * 任务轮询管理器
 * @module presentation/adapters/web/pages/assistant/TaskPollingManager
 */

/**
 * 任务轮询管理器
 * 负责定时扫描任务状态并更新聊天记录和视图
 * 
 * 核心思路：
 * - 存储层（聊天记录）是唯一数据源
 * - 每次调度都尝试将存储层同步到视图层
 * - 视图层更新失败没关系，下次调度还会重试
 * - 最终保证一致性
 */
export class TaskPollingManager {
  private renderer: any;
  private useCase: any;
  private scanInterval: number = 2000; // 每 2 秒扫描一次
  private scanIntervalId: number | null = null;
  private isScanning: boolean = false; // 防止并发扫描
  
  constructor(renderer: any, useCase: any) {
    this.renderer = renderer;
    this.useCase = useCase;
  }
  
  /**
   * 启动定时扫描
   */
  startScanning(): void {
    // 如果已经在扫描，不重复启动
    if (this.scanIntervalId) {
      // 但立即执行一次扫描
      this.scanAllTasks();
      return;
    }
    
    // 立即扫描一次
    this.scanAllTasks();
    
    // 启动定时扫描
    this.scanIntervalId = window.setInterval(() => {
      this.scanAllTasks();
    }, this.scanInterval);
  }
  
  /**
   * 立即扫描一次
   */
  scanNow(): void {
    this.scanAllTasks();
  }
  
  /**
   * 扫描所有任务
   * 
   * 1. 从聊天记录获取所有有 taskId 且未完成的消息
   * 2. 查询任务状态
   * 3. 如果任务完成，更新聊天记录并标记为已完成
   * 4. 同步聊天记录到视图
   */
  private async scanAllTasks(): Promise<void> {
    // 防止并发扫描
    if (this.isScanning) {
      return;
    }
    
    this.isScanning = true;
    
    try {
      // 检查 TaskBridge 是否可用
      if (!window.TaskBridge) {
        console.warn('[TaskPollingManager] TaskBridge 不可用');
        return;
      }
      
      // 1. 从聊天记录获取所有消息
      const messages = this.useCase.getMessages();
      
      // 2. 过滤出有 taskId 且未完成的消息
      const activeMessages = messages.filter((msg: any) => msg.taskId && !msg.taskCompleted);
      
      if (activeMessages.length === 0) {
        // 没有活动任务，跳过
        return;
      }
      
      // 3. 对每个活动的消息：
      for (const message of activeMessages) {
        if (!message.taskId) continue;
        
        try {
          // 3a. 查询任务状态
          const status = await window.TaskBridge.getStatus(message.taskId);
          
          // 3b. 如果任务不存在或已完成，更新聊天记录并标记为已完成
          if (!status || status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
            // 构造新的消息内容
            const newContent = status ? this.buildTaskResult(status) : '❌ 任务不存在';
            
            // 更新聊天记录（存储层），同时标记为已完成
            await this.useCase.updateTaskMessage(message.taskId, newContent, true);
            
            // 删除任务
            if (status) {
              await window.TaskBridge?.deleteTask(message.taskId);
            }
            
            console.log(`[TaskPollingManager] 任务 ${message.taskId} 已完成并删除`);
            
            // 更新 message 变量，用于后续同步视图
            message.content = newContent;
            message.taskCompleted = true;
            
            // 3c. 任务完成，同步视图
            this.syncMessageToView(message);
          } else if (status.status === 'running' || status.status === 'pending') {
            // 任务运行中：只更新视图层，复用 updateTaskStatusElement 方法
            this.syncTaskProgressToView(message.taskId, status);
          }
          
        } catch (error) {
          console.error(`[TaskPollingManager] 处理任务 ${message.taskId} 失败:`, error);
        }
      }
    } finally {
      this.isScanning = false;
    }
  }
  
  /**
   * 同步消息到视图（DOM）
   * 
   * 将聊天记录中的内容同步到视图层
   * 如果 DOM 节点不存在或同步失败，没关系，下次调度还会重试
   */
  private syncMessageToView(message: any): void {
    try {
      this.renderer.syncMessageContent(message.taskId, message.content);
    } catch (error) {
      // 同步失败没关系，下次调度还会重试
      console.warn(`[TaskPollingManager] 同步消息到视图失败，下次重试:`, error);
    }
  }
  
  /**
   * 同步任务进度到视图（仅视图层，简化文本）
   */
  private syncTaskProgressToView(taskId: string, status: any): void {
    try {
      // 找到消息块
      const messageBlock = document.querySelector(`.message.assistant[data-task-id="${taskId}"]`);
      if (!messageBlock) {
        return; // DOM 节点不存在，下次重试
      }
      
      // 找到 markdown-content 元素
      const markdownDiv = messageBlock.querySelector('.markdown-content');
      if (!markdownDiv) {
        return; // 元素不存在，下次重试
      }
      
      // 构造简化的进度文本
      const progressText = this.buildProgressText(status);
      
      // 更新 markdown 内容
      import('marked').then(async ({ marked }) => {
        marked.setOptions({
          breaks: true,
          gfm: true,
        });
        
        markdownDiv.innerHTML = await marked.parse(progressText);
        
        // 存储 markdown 内容，用于下次比较
        const contentDiv = messageBlock.querySelector('.message-content');
        if (contentDiv) {
          contentDiv.setAttribute('data-markdown-content', progressText);
        }
      });
    } catch (error) {
      // 视图更新失败没关系，下次轮询还会重试
      console.warn(`[TaskPollingManager] 同步进度到视图失败:`, error);
    }
  }
  
  /**
   * 构造简化的进度文本
   */
  private buildProgressText(status: any): string {
    const progress = status.progress || 0;
    const progressMessage = status.progressMessage || '';
    
    // 简化的进度文本
    let text = `正在执行...`;
    
    if (progress > 0) {
      text += `\n\n📊 进度: ${progress}%`;
      if (progressMessage) {
        text += ` - ${progressMessage}`;
      }
    }
    
    // 添加换行，与取消按钮保持间距
    text += '\n\n<br>';
    
    return text;
  }
  
  /**
   * 构造任务结果消息
   */
  private buildTaskResult(status: any): string {
    if (status.status === 'completed') {
      let content = '✅ ' + (status.result?.title || '任务完成');
      if (status.result && status.result.message) {
        content += `\n\n${status.result.message}`;
      }
      return content;
    } else if (status.status === 'failed') {
      let content = '❌ ' + (status.result?.title || '任务失败');
      if (status.result && status.result.message) {
        content += `\n\n${status.result.message}`;
      }
      return content;
    } else if (status.status === 'cancelled') {
      return '🚫 已取消';
    }
    return '';
  }
  
  /**
   * 停止扫描
   */
  stopScanning(): void {
    if (this.scanIntervalId) {
      window.clearInterval(this.scanIntervalId);
      this.scanIntervalId = null;
    }
  }
}
