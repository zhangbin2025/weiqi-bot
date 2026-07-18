/**
 * AI 助手用例实现
 * @module application/assistant/AssistantUseCase
 */
import type { IAssistantUseCase, IntentRecognizeResult } from './IAssistantUseCase';
import type { IMessageRenderer } from './IMessageRenderer';
import type { IJumpDecision, AlternativeIntent } from './IJumpDecision';
import type { IEntityExtractor } from '../../domain/intent/IEntityExtractor';
import type { ISessionService } from '../../services/session/ISessionService';
import type { IManagementService } from '../../services/management/IManagementService';
import type { StorageBrowserService } from '../../services/storage/StorageBrowserService';
import type { PerformanceBrowserService } from '../../services/performance/PerformanceBrowserService';
import type { IExportService } from '../../services/export';
import type { IDialog } from '../../presentation/core/interfaces/IDialog';
import { IntentRecognizer } from '../../domain/intent';
import { INTENT_CONFIG } from '../../domain/intent/intent-config';
import { ChatHistoryManager } from './ChatHistoryManager';
import { ScheduleManager } from '../../domain/schedule';
import { CommandHandler } from './CommandHandler';
import { buildArchiveUrl } from '../../domain/sgf/SGFUtils';
import { checkRequiredParamsForBackground } from '../../domain/intent/BackgroundTaskChecker';
/**
 * AI 助手用例配置
 */
export interface AssistantUseCaseConfig {
  messageRenderer: IMessageRenderer;
  jumpDecision: IJumpDecision;
  entityExtractor: IEntityExtractor;
  chatHistoryManager: ChatHistoryManager;
  sessionService?: ISessionService; // SessionService(可选)
  managementService: IManagementService; // 管理服务
  exportService?: IExportService; // 导出服务(可选)
  storageService?: any; // 存储服务(可选)
  storageBrowserService?: StorageBrowserService; // 存储浏览服务(可选)
  performanceBrowserService?: PerformanceBrowserService; // 性能浏览服务(可选)
  dialog?: IDialog; // 对话框(可选)
}
/**
 * AI 助手用例
 * 协调意图识别、实体提取、跳转决策等模块
 */
export class AssistantUseCase implements IAssistantUseCase {
  private messageRenderer: IMessageRenderer;
  private jumpDecision: IJumpDecision;
  private entityExtractor: IEntityExtractor;
  private chatHistoryManager: ChatHistoryManager;
  private sessionService: ISessionService | undefined; // SessionService 实例(可选)
  private exportService: IExportService | undefined; // 导出服务(可选)
  private intentRecognizer: IntentRecognizer;
  private commandHandler: CommandHandler;
  constructor(config: AssistantUseCaseConfig) {
    this.messageRenderer = config.messageRenderer;
    this.jumpDecision = config.jumpDecision;
    this.entityExtractor = config.entityExtractor;
    this.chatHistoryManager = config.chatHistoryManager;
    this.sessionService = config.sessionService; // 接收 SessionService
    this.exportService = config.exportService; // 接收导出服务
    this.intentRecognizer = new IntentRecognizer();
    this.commandHandler = new CommandHandler({
      messageRenderer: config.messageRenderer,
      chatHistoryManager: config.chatHistoryManager,
      managementService: config.managementService,
      storageService: config.storageService,
      storageBrowserService: config.storageBrowserService,
      performanceBrowserService: config.performanceBrowserService,
      dialog: config.dialog,
    });
  }

  /**
   * 设置 ChatHistoryManager(用于延迟初始化)
   */
  setChatHistoryManager(chatHistoryManager: ChatHistoryManager): void {
    this.chatHistoryManager = chatHistoryManager;
    // 同时更新 CommandHandler 的 chatHistoryManager
    (this.commandHandler as any).chatHistoryManager = chatHistoryManager;
  }
  /**
   * 初始化
   */
  async init(): Promise<void> {
    // 不再需要 showCompletedTasks,因为任务结果已经通过 updateMessageByTaskId 更新到消息历史中
  }

  /**
   * 查询并显示已完成的任务
   */
  private async showCompletedTasks(): Promise<void> {
    try {
      // 检查是否在 App 环境中
      if (typeof window === 'undefined' || !window.TaskBridge) {
        console.log('Not in App environment or TaskBridge not available');
        return;
      }

      // 获取已完成的任务列表
      const completedTasks = await window.TaskBridge.getCompletedTasks();

      if (!completedTasks || completedTasks.length === 0) {
        console.log('No completed tasks');
        return;
      }

      console.log(`Found ${completedTasks.length} completed tasks`);

      // 按时间排序(已在后端排序,这里只是确保)
      completedTasks.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

      // 显示每个任务的结果
      for (const task of completedTasks) {
        await this.showTaskResult(task);

        // 删除已显示的任务
        try {
          await window.TaskBridge.deleteTask(task.id);
          console.log(`Deleted task: ${task.id}`);
        } catch (error) {
          console.error(`Failed to delete task ${task.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Failed to show completed tasks:', error);
    }
  }

  /**
   * 显示单个任务的结果
   */
  private async showTaskResult(task: any): Promise<void> {
    // 构造回复消息
    let responseText = `✅ ${task.title || '任务完成'}\n\n${task.message || '任务已成功完成'}`;

    // 如果有详情链接,添加导航链接
    if (task.detailUrl) {
      // 构造完整的 URL
      const fullUrl = task.detailUrl.startsWith('http')
        ? task.detailUrl
        : `http://localhost:8088${task.detailUrl}`;

      responseText += `\n\n[查看详情](${fullUrl})`;
    }

    // 显示回复
    await this.messageRenderer.renderMessage(responseText, false);
    await this.chatHistoryManager.addMessage({
      role: 'assistant',
      content: responseText,
    });
  }
  /**
   * 发送消息
   */
  async sendMessage(text: string): Promise<void> {
    if (!text || !text.trim()) {
      return;
    }

    // 添加用户消息(命令和普通消息都需要保存)
    await this.messageRenderer.renderMessage(text, true);
    await this.chatHistoryManager.addMessage({
      role: 'user',
      content: text,
    });

    // 检查是否是命令(以 "/" 开头)
    if (text.trim().startsWith('/')) {
      await this.commandHandler.handleCommand(text);
      return;
    }

    // 显示打字状态
    this.messageRenderer.showTyping();
    // 预测意图
    const recognizeResult = this.predictIntent(text);
    const intent = recognizeResult.intent;
    const params = recognizeResult.params;
    const alternatives = recognizeResult.alternatives;
    const responseType = recognizeResult.responseType || 'foreground';

    // 提取实体(合并结果)
    const entities = { ...this.entityExtractor.extract(text, intent), ...params };

    // 保存原始文本(用于周期性任务解析时间表达式)
    entities['text'] = text;

    // 处理查询任务进度
    if (intent === 'query_task_progress') {
      await this.handleQueryTaskProgress(entities);
      return;
    }

    // 处理取消任务
    if (intent === 'cancel_task') {
      await this.handleCancelTask(entities);
      return;
    }

    // 隐藏打字状态
    this.messageRenderer.hideTyping();
    // 如果检测到 SGF 内容,通过 SessionService 传递避免 URL 过长
    if (entities['sgf']) {
      if (this.sessionService) {
        // 通过 SessionService 传递 SGF，URL 只传 sessionId（约30字符）
        const sessionId = await this.sessionService.create('fetcher', { sgf: entities['sgf'] });
        delete entities['sgf'];
        entities['sessionId'] = sessionId;
        console.info('[AssistantUseCase] 已通过 SessionService 传递 SGF, sessionId:', sessionId);
      } else {
        // fallback：无 SessionService 时仍用 archive URL（兼容旧环境）
        const archiveUrl = buildArchiveUrl(entities['sgf']);
        entities['url'] = archiveUrl;
        delete entities['sgf'];
        console.warn('[AssistantUseCase] SessionService 不可用，SGF 通过 archive URL 传递，可能超长');
      }
    }
    // 获取跳转决策
    const decision = this.jumpDecision.getJumpDecision(
      intent,
      recognizeResult.confidence,
      entities,
      alternatives
    );
    // 检查是否显示候选意图
    if (decision.showAlternatives && alternatives && alternatives.length > 0) {
      await this.handleAlternatives(intent, entities, alternatives);
      return;
    }
    // 获取意图配置
    const config = INTENT_CONFIG[intent];
    if (config) {
      // 检测是否在 App 环境中
      const isApp = this.isAppEnvironment();

      // 检测是否支持后台任务
      const supportsBackground = this.supportsBackgroundTask(intent);

      // 检查是否满足后台任务的必要参数
      const hasRequiredParams = checkRequiredParamsForBackground(intent, entities);

      // 最终判断:是否可以后台执行
      const canBackground = supportsBackground && hasRequiredParams;

      // 根据响应类型和环境决定执行方式
      // 优先级:周期性 > 用户明确后台 > 用户明确前台 > App环境默认后台 > 前台

      // 检查是否是用户明确要求前台执行(通过关键词判断)
      const FOREGROUND_KEYWORDS = ['打开', '查看', '看看', '显示', '进入', '手动'];
      const hasForegroundKeyword = FOREGROUND_KEYWORDS.some(kw => text.includes(kw));

      console.log('[AssistantUseCase] 任务执行判断:', {
        intent,
        responseType,
        isApp,
        supportsBackground,
        hasRequiredParams,
        canBackground,
        hasForegroundKeyword,
        entities: { archiveId: entities['archiveId'], player: entities['player'] }
      });

      if (responseType === 'periodic') {
        // 周期性任务
        await this.handlePeriodicTask(intent, entities, config);
      } else if (responseType === 'background') {
        // 用户明确要求后台执行
        await this.handleBackgroundTask(intent, entities, config);
      } else if (hasForegroundKeyword) {
        // 用户明确要求前台执行(有"打开"、"查看"等关键词),尊重用户选择
        await this.handleIntent(intent, entities, config, decision);
      } else if (isApp && canBackground) {
        // App环境+支持后台+满足必要参数 → 默认后台执行
        console.log('[AssistantUseCase] 执行后台任务');
        await this.handleBackgroundTask(intent, entities, config);
      } else {
        // 其他情况:前台执行
        console.log('[AssistantUseCase] 执行前台任务');
        await this.handleIntent(intent, entities, config, decision);
      }
    } else if (intent === 'help') {
      await this.handleHelp();
    } else {
      await this.handleUnknown();
    }
  }

  /**
   * 检测是否在 App 环境中
   */
  private isAppEnvironment(): boolean {
    return typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp');
  }

  /**
   * 检测是否支持后台任务
   */
  private supportsBackgroundTask(intent: string): boolean {
    // 支持后台任务的意图列表
    const backgroundSupportedIntents = [
      'query_player',
      'analyze_opponent',
      'discover_joseki',  // 定式发现
      'generate_decision',  // 实战选点
      'download_game',  // 抓取棋谱
      'start_review',  // 复盘分析
    ];
    return backgroundSupportedIntents.includes(intent);
  }

  /**
   * 检测是否支持周期性任务
   */
  private supportsPeriodicTask(intent: string): boolean {
    // 支持周期性任务的意图列表
    const periodicSupportedIntents = [
      'query_player',
      'analyze_opponent',
      'discover_joseki',
      'generate_decision',
      // ❌ download_game 不支持周期性任务
      // ❌ start_review 不支持周期性任务
    ];
    return periodicSupportedIntents.includes(intent);
  }

  /**
   * 处理周期性任务
   */
  private async handlePeriodicTask(
    intent: string,
    entities: Record<string, any>,
    config: any
  ): Promise<void> {
    // 检查是否支持周期性任务
    if (!this.supportsPeriodicTask(intent)) {
      const text = `${config.name}不支持定时任务,只能立即执行`;
      await this.messageRenderer.renderMessage(text, false);
      await this.chatHistoryManager.addMessage({
        role: 'assistant',
        content: text,
      });
      return;
    }

    // 检查是否在 App 环境中
    if (!this.isAppEnvironment()) {
      const text = '抱歉,定时任务功能仅在 App 中可用';
      await this.messageRenderer.renderMessage(text, false);
      await this.chatHistoryManager.addMessage({
        role: 'assistant',
        content: text,
      });
      return;
    }

    try {
      // 从用户输入中解析时间和频率
      const text = entities['text'] || '';
      const scheduleConfig = ScheduleManager.createConfig(intent, entities, text);

      // 添加业务页面 URL(从配置中获取)
      if (config.path) {
        const params = new URLSearchParams();
        params.set('scheduleId', '__SCHEDULE_ID__'); // 占位符,后面会被替换

        // 添加业务参数
        for (const param of config.params) {
          if (entities[param]) {
            params.set(param, entities[param]);
          }
        }

        scheduleConfig.pageUrl = `${config.path}?${params.toString()}`;
      }

      // 添加计划
      const scheduleId = await window.TaskBridge!.addSchedule(scheduleConfig);

      // 显示成功消息
      const timeDesc = ScheduleManager.getTimeDescription(scheduleConfig);
      const message = `✅ 已创建定时任务\n\n${timeDesc} 自动${config.name || '执行任务'}\n\n计划 ID: ${scheduleId}\n\n[▶️ 立即执行](schedule-run:${scheduleId})`;

      await this.messageRenderer.renderMessage(message, false, intent, entities);
      await this.chatHistoryManager.addMessage({
        role: 'assistant',
        content: message,
        intent,
        entities,
      });

      console.log('[handlePeriodicTask] Schedule created:', scheduleId, scheduleConfig);
    } catch (error) {
      console.error('[handlePeriodicTask] Failed to create schedule:', error);
      const errorMessage = `❌ 创建定时任务失败\n\n${error instanceof Error ? error.message : '未知错误'}`;
      await this.messageRenderer.renderMessage(errorMessage, false);
      await this.chatHistoryManager.addMessage({
        role: 'assistant',
        content: errorMessage,
      });
    }
  }
  /**
   * 预测意图
   */
  private predictIntent(text: string): IntentRecognizeResult {
    return this.intentRecognizer.recognize(text);
  }
  /**
   * 处理候选意图
   */
  private async handleAlternatives(
    intent: string,
    entities: Record<string, any>,
    alternatives: AlternativeIntent[]
  ): Promise<void> {
    const alternativeIntents = alternatives.map(alt => alt.intent);
    const allIntents = [intent, ...alternativeIntents];
    // 检查是否有 SGF 参数,如果有则通过 SessionService 传递
    let processedEntities = { ...entities };
    if (entities['sgf'] && this.sessionService) {
      const sessionId = await this.sessionService.create('replay', { sgf: entities['sgf'] });
      delete processedEntities['sgf'];
      processedEntities['sessionId'] = sessionId;
      console.info('已通过 SessionService 传递 SGF,sessionId:', sessionId);
    }
    // 构建候选链接 HTML
    const linksHtml = allIntents.map((int, idx) => {
      const cfg = INTENT_CONFIG[int];
      const name = cfg?.name || int;
      // 只有当 cfg 存在时才构建跳转链接
      const jumpUrl = cfg ? this.jumpDecision.buildJumpUrl(int, processedEntities, cfg) : '#';
      return `<a href="${jumpUrl}" class="intent-option-link" data-intent="${int}" style="display: inline-block; margin: 8px 12px 8px 0; color: #667eea; text-decoration: none; font-size: 15px; font-weight: 500;">${idx + 1}. ${name}</a>`;
    }).join('');
    const responseText = `我识别到多个可能的意图,请选择:\n\n${linksHtml}`;
    // 添加消息并展示候选链接
    await this.messageRenderer.renderMessage(responseText, false, intent, entities);
    await this.chatHistoryManager.addMessage({
      role: 'assistant',
      content: responseText,
      intent,
      entities,
    });
    console.info('检测到候选意图,已显示链接:', allIntents);
  }
  /**
   * 处理已知意图
   */
  private async handleIntent(
    intent: string,
    entities: Record<string, any>,
    config: any,
    decision: { shouldJump: boolean; countdown: number; showAlternatives: boolean }
  ): Promise<void> {
    // 检查是否有 SGF 参数,如果有则通过 SessionService 传递
    let processedEntities = { ...entities };
    if (entities['sgf'] && this.sessionService) {
      const sessionId = await this.sessionService.create('replay', { sgf: entities['sgf'] });
      // 移除 sgf 参数,添加 sessionId
      delete processedEntities['sgf'];
      processedEntities['sessionId'] = sessionId;
      console.info('已通过 SessionService 传递 SGF,sessionId:', sessionId);
    }

    // 获取响应类型(从 decision 或 detectResponseType 获取)
    // 这里暂时不实现,等待 IntentRecognizer 传递 responseType
    // const responseType = decision.responseType || 'foreground';

    // 暂时使用原有逻辑
    // 构建跳转 URL
    const jumpUrl = this.jumpDecision.buildJumpUrl(intent, processedEntities, config);
    // 根据是否自动跳转决定文案
    const actionText = decision.shouldJump
      ? `自动执行 → ${config.name}`
      : `前往 ${config.name}`;
    // 构建回复
    let responseText = `好的!我将为您打开${config.name}`;
    if (Object.keys(entities).length > 0) {
      // 过滤掉URL类型的值,并缩短过长的值
      const displayValues = Object.entries(entities)
        .filter(([key, value]) => {
          // 过滤掉URL
          if (typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))) {
            return false;
          }
          // 过滤掉 text 参数（用于周期性任务，不需要显示）
          if (key === 'text') {
            return false;
          }
          return true;
        })
        .map(([key, value]) => {
          // 缩短过长的值
          if (typeof value === 'string' && value.length > 20) {
            return value.substring(0, 15) + '...';
          }
          return value;
        })
        .filter(v => v);
      if (displayValues.length > 0) {
        responseText += `(${displayValues.join('、')})`;
      }
    }
    responseText += '。';
    // 添加回复消息
    await this.messageRenderer.renderMessage(responseText, false, intent, entities, jumpUrl, actionText);
    await this.chatHistoryManager.addMessage({
      role: 'assistant',
      content: responseText,
      intent,
      entities,
      actionUrl: jumpUrl,
      actionText,
    });
    console.info('AI 消息已渲染和保存');
    // 根据跳转决策执行跳转
    if (decision.shouldJump && decision.countdown > 0) {
      this.messageRenderer.showCountdownJump(jumpUrl, decision.countdown, () => {
        console.info('用户取消了跳转');
      });
    }
  }
  /**
   * 处理帮助意图
   */
  private async handleHelp(): Promise<void> {
    const helpText = `我是围棋 AI 助手,可以帮您:

- 👤 **[查询棋手](../player/index.html)**
  - 查询业余棋手信息
  - 示例: <a href="#" onclick="quickSend('马天放'); return false;">马天放</a>

- 🎯 **[开始对弈](../play/index.html)**
  - 人机/真人/AI自对弈
  - 示例: <a href="#" onclick="quickSend('下棋'); return false;">下棋</a>

- 📊 **[分析对手](../opponent/index.html)**
  - 分析棋手棋谱和定式
  - 示例: <a href="#" onclick="quickSend('分析对手天启'); return false;">天启</a> <a href="#" onclick="quickSend('分析对手段誉'); return false;">段誉</a>

- 🔍 **[复盘分析](../review/index.html)**
  - AI复盘棋局
  - 示例: <a href="#" onclick="quickSend('复盘'); return false;">复盘</a>

- 📝 **[学习定式](../joseki/explore.html)**
  - 探索/发现/挑战定式
  - 示例: <a href="#" onclick="quickSend('定式'); return false;">定式</a>

- 🎯 **[实战选点](../decision/index.html)**
  - 决策训练
  - 示例: <a href="#" onclick="quickSend('做题'); return false;">做题</a>

- 📋 **[记录棋谱](../recorder/index.html)**
  - 记录对局
  - 示例: <a href="#" onclick="quickSend('记谱'); return false;">记谱</a>

- 🏆 **[查询赛事](../event/index.html)**
  - 云比赛查询
  - 示例: <a href="#" onclick="quickSend('比赛'); return false;">比赛</a>

- 📥 **[抓取棋谱](../fetcher/index.html)**
  - 从分享链接抓取棋谱
  - 示例: <a href="../fetcher/index.html">抓取棋谱</a>

---

💡 直接用自然语言告诉我您想做什么,我会自动识别您的意图!`;
    await this.messageRenderer.renderMessage(helpText, false);
    await this.chatHistoryManager.addMessage({
      role: 'assistant',
      content: helpText,
    });
  }
  /**
   * 处理未知意图
   */
  private async handleUnknown(): Promise<void> {
    const text = '抱歉,我不太理解您的意思,请换一种说法试试。';
    await this.messageRenderer.renderMessage(text, false);
    await this.chatHistoryManager.addMessage({
      role: 'assistant',
      content: text,
    });
  }
  /**
   * 新建会话
   */
  async newSession(): Promise<void> {
    await this.chatHistoryManager.createSession('新对话');
    console.info('已创建新会话');
  }
  /**
   * 显示历史记录
   */
  async showHistory(): Promise<void> {
    const sessions = await this.chatHistoryManager.getAllSessions();
    console.info(`共有 ${sessions.length} 个历史会话`);
    // TODO: 通过渲染器显示会话列表
  }
  /**
   * 清空所有历史
   */
  async clearAllHistory(): Promise<void> {
    await this.chatHistoryManager.clearAll();
    // 清空 UI 显示
    this.messageRenderer.clearMessages();
    console.info('已清空所有聊天历史');
  }
  /**
   * 导出历史记录
   */
  async exportHistory(): Promise<void> {
    try {
      const sessions = await this.chatHistoryManager.getAllSessions();
      if (sessions.length === 0) {
        const msg = '暂无历史记录可导出';
        await this.messageRenderer.renderMessage(msg, false);
        return;
      }
      // 收集所有会话和消息
      const exportData = [];
      for (const session of sessions) {
        const messages = await this.chatHistoryManager.loadSession(session.sessionId);
        exportData.push({
          sessionId: session.sessionId,
          title: session.data.title,
          createdAt: new Date(session.data.createdAt).toISOString(),
          updatedAt: new Date(session.data.updatedAt).toISOString(),
          messages: messages || [],
        });
      }
      // 通过导出服务保存
      const filename = `weiqi-chat-history-${new Date().toISOString().slice(0, 10)}.json`;
      
      if (this.exportService) {
        const result = await this.exportService.exportHistory(exportData, filename);
        
        if (!result.success) {
          const msg = `导出失败: ${result.error}`;
          await this.messageRenderer.renderMessage(msg, false);
          return;
        }
      } else {
        // Fallback: 直接使用 WebFileExporter
        const { WebFileExporter } = await import('../../infrastructure/utils/export/WebFileExporter');
        const exporter = new WebFileExporter();
        const json = JSON.stringify(exportData, null, 2);
        const result = await exporter.exportText(json, filename, { mimeType: 'application/json' });
        
        if (!result.success) {
          const msg = `导出失败: ${result.error}`;
          await this.messageRenderer.renderMessage(msg, false);
          return;
        }
      }
      const msg = `已导出 ${sessions.length} 个会话记录`;
      await this.messageRenderer.renderMessage(msg, false);
      console.info('已导出聊天历史');
    } catch (error) {
      console.error('导出历史记录失败:', error as Error);
      const msg = '导出历史记录失败,请稍后重试';
      await this.messageRenderer.renderMessage(msg, false);
    }
  }

  /**
   * 处理后台任务
   */
  private async handleBackgroundTask(
    intent: string,
    entities: Record<string, any>,
    config: any
  ): Promise<void> {
    // 构造业务 URL
    const jumpUrl = this.jumpDecision.buildJumpUrl(intent, entities, config);
    const pageUrl = jumpUrl.startsWith('http') ? jumpUrl : `http://localhost:8088${jumpUrl.replace('..', '')}`;

    // 检查是否在 App 中(通过 user agent 判断)
    const isApp = typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp');

    if (!isApp) {
      await this.messageRenderer.renderMessage('抱歉,后台任务功能仅在 App 中可用', false);
      await this.chatHistoryManager.addMessage({
        role: 'assistant',
        content: '抱歉,后台任务功能仅在 App 中可用',
      });
      return;
    }

    // 提交后台任务(通过 TaskBridge)
    try {
      // 如果 TaskBridge 不存在,尝试请求注入
      if (!window.TaskBridge) {
        console.log('TaskBridge not found, requesting injection...');
        // 通过 prompt 请求 Kotlin 注入 TaskBridge
        prompt('injectTaskBridge');
        // 等待 100ms 让注入完成
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // 再次检查
      if (!window.TaskBridge) {
        throw new Error('TaskBridge 注入失败,请重启 App');
      }

      // 设置任务完成回调
      (window as any).onTaskComplete = (jsonData: string) => {
        try {
          const data = JSON.parse(jsonData);
          this.handleTaskComplete(data);
        } catch (error) {
          console.error('Failed to parse task complete data:', error);
        }
      };

      // submitTask 返回任务对象
      const result = await window.TaskBridge.submitTask(
        intent,
        entities,
        { pageUrl }
      );

      // 从对象中获取 taskId
      const taskId = typeof result === 'string' ? result : (result as any).taskId;

      console.info('[AssistantUseCase] 后台任务已提交:', {
        taskId,
        intent,
        entities,
        pageUrl,
        result
      });

      // 构造简洁的任务执行提示
      let responseText = '';

      // 获取初始任务状态
      console.log('[AssistantUseCase] 查询初始任务状态:', taskId);
      const initialStatus = await window.TaskBridge.getStatus(taskId);
      console.log('[AssistantUseCase] 初始任务状态:', {
        taskId,
        status: initialStatus?.status,
        progress: initialStatus?.progress
      });

      if (initialStatus && initialStatus.status === 'completed') {
        // 任务已完成,直接显示结果
        responseText = '✅ 查询完成';

        if (initialStatus.result && initialStatus.result.message) {
          responseText += `\n\n${initialStatus.result.message}`;
        }

        // 如果有详情链接,添加导航链接
        if (initialStatus.result && initialStatus.result.detailUrl) {
          const fullUrl = initialStatus.result.detailUrl.startsWith('http')
            ? initialStatus.result.detailUrl
            : `http://localhost:8088${initialStatus.result.detailUrl}`;
          responseText += `\n\n[查看详情](${fullUrl})`;
        }
      } else {
        // 任务执行中,显示简洁的进度提示
        const actionName = config.name || '正在执行';
        const paramValue = entities['player'] || entities['name'] || Object.values(entities)[0] || '';

        responseText = `正在${actionName}`;
        if (paramValue) {
          responseText += `"${paramValue}"`;
        }

        // 获取进度
        const progress = initialStatus?.progress || 0;
        if (progress > 0) {
          responseText += `...(进度 ${progress}%)`;
        } else {
          responseText += '...';
        }
      }

      // 显示回复(包含意图、参数、任务状态/结果)
      await this.messageRenderer.renderMessage(responseText, false, intent, entities, undefined, undefined, true, taskId);

      // 给最后一个消息块添加取消按钮（如果任务执行中）
      if (initialStatus && initialStatus.status !== 'completed') {
        const chatContainer = document.getElementById('chatContainer');
        if (chatContainer) {
          const lastMessage = chatContainer.lastElementChild as HTMLElement;
          if (lastMessage && lastMessage.classList.contains('assistant')) {
            const contentDiv = lastMessage.querySelector('.message-content');
            if (contentDiv) {
              const cancelButton = document.createElement('button');
              cancelButton.className = 'cancel-task-btn';
              cancelButton.setAttribute('data-task-id', taskId);
              cancelButton.style.cssText = 'background: transparent; border: none; cursor: pointer; font-size: 16px; padding: 0; margin-left: 8px; line-height: 1;';
              cancelButton.title = '取消任务';
              cancelButton.textContent = '❌';

              cancelButton.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleCancelTask({ taskId });
              });

              contentDiv.appendChild(cancelButton);
            }
          }
        }
      }

      await this.chatHistoryManager.addMessage({
        role: 'assistant',
        content: responseText,
        intent,
        entities,
        taskId,  // 添加 taskId,用于后续更新
      });

      console.info('后台任务已提交:', taskId);
    } catch (error) {
      const errorText = `提交后台任务失败: ${error instanceof Error ? error.message : '未知错误'}`;
      await this.messageRenderer.renderMessage(errorText, false);
      await this.chatHistoryManager.addMessage({
        role: 'assistant',
        content: errorText,
      });
      console.error('提交后台任务失败:', error);
    }
  }

  /**
   * 处理任务完成通知
   */
  private async handleTaskComplete(data: { taskId: string; title: string; message: string; detailUrl?: string }) {
    console.log('Task completed:', data);

    // 不再新回复消息,而是通过 TaskPollingManager 的轮询来更新任务状态块
    // 如果有详情链接,保存到任务结果中,让轮询时显示
    //
    // 注意:这个回调仍然保留,因为 Android 端会在任务完成时调用它
    // 但我们不再在这里显示新消息,避免重复

    // 清理回调
    delete (window as any).onTaskComplete;
  }

  /**
   * 处理查询任务进度
   */
  public async handleQueryTaskProgress(entities: Record<string, any>): Promise<void> {
    const taskId = entities['taskId'];

    if (!taskId) {
      const text = '请提供任务 ID';
      await this.messageRenderer.renderMessage(text, false);
      await this.chatHistoryManager.addMessage({ role: 'assistant', content: text });
      return;
    }

    try {
      // 调用 TaskBridge.getStatus()
      const status = await (window as any).TaskBridge.getStatus(taskId);

      console.log('[handleQueryTaskProgress] 状态返回:', status);

      if (!status) {
        const text = `任务 ${taskId} 不存在或已被删除`;
        await this.messageRenderer.renderMessage(text, false);
        await this.chatHistoryManager.addMessage({ role: 'assistant', content: text });
        return;
      }

      // 格式化返回
      let responseText = `任务 ID: ${taskId}\n\n`;
      responseText += `状态: ${this.formatTaskStatus(status.status || 'unknown')}\n`;
      responseText += `进度: ${status.progress || 0}%\n`;

      if (status.progressMessage) {
        responseText += `详情: ${status.progressMessage}\n`;
      }

      // 如果任务已完成,显示结果
      if (status.status === 'completed' && status.result) {
        responseText += `\n结果: ${status.result.message}`;
      }

      // 如果任务运行中,添加取消提示(AssistantRenderer 会自动处理 taskId 链接)
      if (status.status === 'running') {
        responseText += `\n\n提示: 点击任务 ID 可查看进度`;
      }

      await this.messageRenderer.renderMessage(responseText, false);
      await this.chatHistoryManager.addMessage({ role: 'assistant', content: responseText });

      // 如果运行中,添加取消按钮
      if (status.status === 'running') {
        // 通过事件通知 Renderer 添加取消按钮
        const event = new CustomEvent('addCancelButton', {
          detail: { taskId },
          bubbles: true
        });
        document.dispatchEvent(event);
      }
    } catch (error) {
      console.error('[handleQueryTaskProgress] 查询失败:', error);
      const text = `查询任务进度失败: ${error instanceof Error ? error.message : '未知错误'}`;
      await this.messageRenderer.renderMessage(text, false);
      await this.chatHistoryManager.addMessage({ role: 'assistant', content: text });
    }
  }

  /**
   * 处理取消任务
   */
  public async handleCancelTask(entities: Record<string, any>): Promise<void> {
    const taskId = entities['taskId'];

    if (!taskId) {
      const text = '请提供任务 ID';
      await this.messageRenderer.renderMessage(text, false);
      await this.chatHistoryManager.addMessage({ role: 'assistant', content: text });
      return;
    }

    // 调用 TaskBridge.cancelTask()
    const success = await (window as any).TaskBridge.cancelTask(taskId);

    if (success) {
      const text = `任务 ${taskId} 已取消`;
      await this.messageRenderer.renderMessage(text, false);
      await this.chatHistoryManager.addMessage({ role: 'assistant', content: text });
    } else {
      const text = `取消任务失败`;
      await this.messageRenderer.renderMessage(text, false);
      await this.chatHistoryManager.addMessage({ role: 'assistant', content: text });
    }
  }

  /**
   * 更新任务消息(用于聊天历史更新)
   *
   * 只在 TaskPollingManager.scanAllTasks() 中调用
   */
  public async updateTaskMessage(taskId: string, newContent: string, taskCompleted?: boolean): Promise<void> {
    // 使用 ChatHistoryManager 的方法,根据 taskId 更新特定消息(全量更新)
    await this.chatHistoryManager.updateMessageByTaskId(taskId, newContent, taskCompleted);
  }
  
  /**
   * 获取当前会话的所有消息
   * 
   * @returns 消息列表
   */
  public getMessages() {
    return this.chatHistoryManager.getMessages();
  }

  /**
   * 格式化任务状态
   */
  private formatTaskStatus(status: string): string {
    const statusMap: Record<string, string> = {
      'pending': '等待中',
      'running': '运行中',
      'completed': '已完成',
      'failed': '失败',
      'cancelled': '已取消',
    };
    return statusMap[status] || status;
  }
}
