/**
 * AI 助手页面
 * @module presentation/adapters/web/pages/assistant/AssistantPage
 */
import { AssistantUseCase } from '../../../../../application/assistant/AssistantUseCase';
import { JumpDecision } from '../../../../../application/assistant/JumpDecision';
import { ChatHistoryManager } from '../../../../../application/assistant/ChatHistoryManager';
import { FavoriteService } from '../../../../../services/favorite/FavoriteService';
import { SessionService } from '../../../../../services/session/SessionService';
import { ManagementService } from '../../../../../services/management/ManagementService';
import { WebStorageService } from '../../../../../services/storage/WebStorageService';
import { AppStorageService } from '../../../../../services/storage/AppStorageService';
import { StorageBrowserService } from '../../../../../services/storage/StorageBrowserService';
import { DebugService } from '../../../../../services/debug/DebugService';
import { PerformanceBrowserService } from '../../../../../services/performance/PerformanceBrowserService';
import { IndexedDBAdapter } from '../../../../../infrastructure/storage/adapters/web/IndexedDBAdapter';
import { LocalStorageCacheAdapter } from '../../../../../infrastructure/storage/adapters/web/LocalStorageCacheAdapter';
import { EntityExtractor } from '../../../../../domain/intent/EntityExtractor';
import { AssistantRenderer } from './AssistantRenderer';
import { UIController } from './UIController';
import { TaskPollingManager } from './TaskPollingManager';
import { ExportService } from '../../../../../services/export/ExportService';
import { WebFileExporter } from '../../../../../infrastructure/utils/export/WebFileExporter';
import { WebDialog } from '../../components/Dialog';
import type { IStorageService } from '../../../../../services/storage/IStorageService';

/**
 * AI 助手页面
 * 组合各模块，初始化应用
 */
export class AssistantPage {
  private useCase: AssistantUseCase;
  private renderer: AssistantRenderer;
  private uiController: UIController;
  private chatHistoryManager: ChatHistoryManager;
  private sessionService: SessionService; // SessionService 实例
  private managementService: ManagementService; // 管理服务
  private taskPollingManager: TaskPollingManager; // 任务轮询管理器
  
  constructor() {
    this.renderer = new AssistantRenderer();
    this.chatHistoryManager = null as any; // 先初始化为 null，在 init() 中真正初始化
    this.sessionService = null as any; // 先初始化为 null，在 init() 中真正初始化
    this.managementService = new ManagementService(); // 创建管理服务
    
    // 创建存储服务（根据环境判断）
    const storageService = this.createStorageService();
    
    // 创建存储浏览服务
    const storageBrowserService = new StorageBrowserService({ storageService, fileExporter: new WebFileExporter() });
    
    // 创建调试服务和性能浏览服务（仅 App 环境）
    const debugService = new DebugService();
    const performanceBrowserService = new PerformanceBrowserService({ debugService });
    
    // 创建导出服务
    const fileExporter = new WebFileExporter();
    const exportService = new ExportService(fileExporter);
    
    // 创建对话框
    const dialog = new WebDialog();
    
    const jumpDecision = new JumpDecision();
    const entityExtractor = new EntityExtractor();
    this.useCase = new AssistantUseCase({
      messageRenderer: this.renderer,
      jumpDecision,
      entityExtractor,
      chatHistoryManager: null as any, // 先传 null，后面会更新
      managementService: this.managementService, // 传入管理服务
      storageService, // 传入存储服务
      storageBrowserService, // 传入存储浏览服务
      performanceBrowserService, // 传入性能浏览服务
      exportService, // 传入导出服务
      dialog, // 传入对话框
    });
    this.uiController = new UIController({
      useCase: this.useCase,
      onSendMessage: (text) => this.handleSendMessage(text),
      sessionService: null as any, // 先传 null，后面会更新
      managementService: this.managementService, // 传入管理服务
    });
    
    // 创建任务轮询管理器（在 useCase 初始化之后）
    this.taskPollingManager = new TaskPollingManager(this.renderer, this.useCase);
  }
  
  /**
   * 创建存储服务（根据环境判断）
   */
  private createStorageService(): IStorageService {
    // 检测是否在 App 环境中
    const isApp = typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp');
    
    if (isApp) {
      return new AppStorageService();
    } else {
      return new WebStorageService();
    }
  }
  /**
   * 初始化页面
   */
  async init(): Promise<void> {
    // 初始化 SessionService
    await this.initSessionService();
    // 先初始化存储和历史管理器
    await this.initChatHistoryManager();
    // 然后初始化用例
    await this.useCase.init();
    this.uiController.enableInput();
    this.uiController.init();
    // 最后加载最近会话
    await this.loadRecentSession();
    
    // 暴露全局方法，让 Android 可以通过 JS 调用来发送消息
    (window as any).assistantSendMessage = (message: string) => {
      this.handleSendMessage(message);
    };
    
    // 监听 taskIdClick 事件
    document.addEventListener('taskIdClick', ((event: CustomEvent) => {
      const { taskId } = event.detail;
      this.useCase.handleQueryTaskProgress({ taskId });
    }) as EventListener);
    
    // 监听 cancelTaskClick 事件
    document.addEventListener('cancelTaskClick', ((event: CustomEvent) => {
      const { taskId } = event.detail;
      this.useCase.handleCancelTask({ taskId });
    }) as EventListener);
    
    // 监听 addCancelButton 事件
    document.addEventListener('addCancelButton', ((event: CustomEvent) => {
      const { taskId } = event.detail;
      this.renderer.addCancelButton(taskId);
    }) as EventListener);
    
    // 启动任务定时扫描
    this.taskPollingManager.startScanning();
    
    // 监听页面可见性变化，页面重新可见时立即扫描一次
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.taskPollingManager.scanNow();
      }
    });
    
    // 监听 pageshow 事件（从缓存恢复或前进/后退）
    window.addEventListener('pageshow', (event) => {
      this.taskPollingManager.scanNow();
    });
    
    // 监听 focus 事件（窗口获得焦点）
    window.addEventListener('focus', () => {
      this.taskPollingManager.scanNow();
    });
    
    // 页面卸载时停止扫描
    window.addEventListener('beforeunload', () => {
      this.taskPollingManager.stopScanning();
    });
    
    // 检查 URL 参数中是否有 taskId
    const urlParams = new URLSearchParams(window.location.search);
    const taskId = urlParams.get('taskId');
    
    if (taskId) {
      // 延迟一点，确保消息块已渲染
      setTimeout(() => this.handleTaskIdNavigation(taskId), 500);
    }
    
    // 检查 URL 参数中是否有 scheduleId
    const scheduleId = urlParams.get('scheduleId');
    
    if (scheduleId) {
      // 周期性任务：查询最后一次执行结果
      setTimeout(() => this.handleScheduleIdNavigation(scheduleId), 500);
    }
    
    // 检查 URL 参数中是否有 text（自动发送消息）
    const text = urlParams.get('text');
    
    if (text) {
      // 延迟一点，确保页面完全初始化
      setTimeout(() => this.handleTextNavigation(text), 500);
    }
  }
  
  /**
   * 处理 taskId 导航（从通知跳转）
   */
  private async handleTaskIdNavigation(taskId: string): Promise<void> {
    // 从历史聊天记录中检查 taskId 是否存在
    const taskExists = this.chatHistoryManager.hasTaskId(taskId);
    
    if (taskExists) {
      
      // 在 DOM 中查找对应的消息块
      const element = document.querySelector(`[data-task-id="${taskId}"]`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('highlight-message');
        setTimeout(() => element.classList.remove('highlight-message'), 2000);
      } else {
        setTimeout(() => {
          const retryElement = document.querySelector(`[data-task-id="${taskId}"]`);
          if (retryElement) {
            retryElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            retryElement.classList.add('highlight-message');
            setTimeout(() => retryElement.classList.remove('highlight-message'), 2000);
          }
        }, 100);
      }
    } else {
      await this.useCase.handleQueryTaskProgress({ taskId });
    }
    
    // 去掉 URL 参数，避免返回时重复触发
    const newUrl = window.location.pathname;
    window.history.replaceState({}, '', newUrl);
  }
  
  /**
   * 处理 scheduleId 导航（从周期性任务通知跳转）
   */
  private async handleScheduleIdNavigation(scheduleId: string): Promise<void> {
    
    try {
      // 查询 scheduleStore 获取最后一次执行结果
      const schedule = await window.TaskBridge?.getSchedule(scheduleId);
      
      if (schedule && schedule.lastResult) {
        // 显示执行结果
        const message = `✅ ${schedule.lastResult.title || '任务完成'}\n\n${schedule.lastResult.message || '任务已成功完成'}`;
        await this.renderer.renderMessage(message, false);
        await this.chatHistoryManager.addMessage({ role: 'assistant', content: message });
      } else {
        // 没有执行结果
        const message = '暂无执行结果';
        await this.renderer.renderMessage(message, false);
        await this.chatHistoryManager.addMessage({ role: 'assistant', content: message });
      }
    } catch (error) {
      console.error(`[AssistantPage] 查询周期性任务失败:`, error);
      const message = `查询周期性任务失败: ${error instanceof Error ? error.message : '未知错误'}`;
      await this.renderer.renderMessage(message, false);
      await this.chatHistoryManager.addMessage({ role: 'assistant', content: message });
    }
    
    // 去掉 URL 参数，避免返回时重复触发
    const newUrl = window.location.pathname;
    window.history.replaceState({}, '', newUrl);
  }
  
  /**
   * 处理 text 导航（自动发送消息）
   */
  private async handleTextNavigation(text: string): Promise<void> {
    
    // 发送消息
    await this.handleSendMessage(text);
    
    // 去掉 URL 参数，避免返回时重复触发
    const newUrl = window.location.pathname;
    window.history.replaceState({}, '', newUrl);
  }
  
  private async initSessionService(): Promise<void> {
    try {
      // 创建 CacheStorage
      const cacheStorage = new LocalStorageCacheAdapter('weiqi-session');
      // 检查是否可用
      if (!cacheStorage.isAvailable()) {
        console.warn('localStorage 不可用，SessionService 将使用内存缓存');
        return;
      }
      // 创建 SessionService
      this.sessionService = new SessionService(cacheStorage);
      await this.sessionService.initialize();
      // 更新 UIController 的 sessionService 引用
      (this.uiController as any).sessionService = this.sessionService;
      // 更新 AssistantUseCase 的 sessionService 引用
      (this.useCase as any).sessionService = this.sessionService;
    } catch (error) {
      // localStorage 不可用时，静默失败
      // SessionService 是可选功能，不影响核心功能
    }
  }
  private createChatHistoryManager(): ChatHistoryManager {
    const storage = new IndexedDBAdapter<{ id: string; category: string; key: string; createdAt: number; }>(
      'weiqi-assistant',
      'favorites'
    );
    const favoriteService = new FavoriteService(storage);
    return new ChatHistoryManager(favoriteService);
  }
  private async initChatHistoryManager(): Promise<void> {
    try {
      // 创建并初始化存储
      const storage = new IndexedDBAdapter<{ id: string; category: string; key: string; createdAt: number; }>(
        'weiqi-assistant',
        'favorites'
      );
      await storage.initialize();
      // 创建服务和管理器
      const favoriteService = new FavoriteService(storage);
      this.chatHistoryManager = new ChatHistoryManager(favoriteService);
      // 更新 useCase 中的 chatHistoryManager
      this.useCase.setChatHistoryManager(this.chatHistoryManager);
      // console.info('聊天历史管理器初始化成功');
    } catch (error) {
      // console.error('初始化聊天历史管理器失败:', error as Error);
    }
  }
  private async loadRecentSession(): Promise<void> {
    try {
      const sessions = await this.chatHistoryManager.getAllSessions();
      if (sessions.length > 0) {
        const recentSession = sessions.sort((a, b) => b.data.updatedAt - a.data.updatedAt)[0];
        if (!recentSession) return;
        const messages = await this.chatHistoryManager.loadSession(recentSession.sessionId);
        if (messages && messages.length > 0) {
          const sortedMessages = messages.sort((a, b) => a.timestamp - b.timestamp);
          for (const msg of sortedMessages) {
            await this.renderer.renderMessage(
              msg.content,
              msg.role === 'user',
              msg.intent,
              msg.entities,
              msg.actionUrl,
              msg.actionText,
              false,
              msg.taskId
            );
          }
          
          // 加载完成后，延迟滚动到最后一条消息
          const chatContainer = document.getElementById('chatContainer');
          if (chatContainer && chatContainer.lastElementChild) {
            setTimeout(() => {
              chatContainer.lastElementChild!.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'end'
              });
            }, 100);
          }
          // console.info(`已加载历史会话: ${recentSession.data.title} (${messages.length} 条消息)`);
        }
      }
    } catch (error) {
      // console.error('加载历史会话失败:', error as Error);
    }
  }
  private async handleSendMessage(text: string): Promise<void> {
    await this.useCase.sendMessage(text);
  }
}
