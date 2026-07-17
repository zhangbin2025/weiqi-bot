/**
 * 命令处理器
 * @module application/assistant/CommandHandler
 */

import type { IMessageRenderer } from './IMessageRenderer';
import type { ChatHistoryManager } from './ChatHistoryManager';
import type { IManagementService } from '../../services/management/IManagementService';
import type { IStorageService } from '../../services/storage/IStorageService';
import type { StorageBrowserService } from '../../services/storage/StorageBrowserService';
import type { PerformanceBrowserService } from '../../services/performance/PerformanceBrowserService';
import type { IDialog } from '../../presentation/core/interfaces/IDialog';

/**
 * 命令处理器配置
 */
export interface CommandHandlerConfig {
  messageRenderer: IMessageRenderer;
  chatHistoryManager: ChatHistoryManager;
  managementService: IManagementService;
  storageService?: IStorageService;
  storageBrowserService?: StorageBrowserService | undefined;
  performanceBrowserService?: PerformanceBrowserService | undefined;
  dialog?: IDialog | undefined;
}

/**
 * 命令处理器
 * 
 * 处理以 "/" 开头的命令，例如：
 * - /version: 显示版本信息
 * - /task: 显示后台任务列表
 * - /schedule: 显示定时计划列表
 * - /perf: 显示性能概览
 * - /help: 显示命令帮助
 */
export class CommandHandler {
  private messageRenderer: IMessageRenderer;
  private chatHistoryManager: ChatHistoryManager;
  private managementService: IManagementService;
  private storageService: IStorageService | undefined;
  private storageBrowserService: StorageBrowserService | undefined;
  private performanceBrowserService: PerformanceBrowserService | undefined;
  private dialog: IDialog | undefined;

  constructor(config: CommandHandlerConfig) {
    this.messageRenderer = config.messageRenderer;
    this.chatHistoryManager = config.chatHistoryManager;
    this.managementService = config.managementService;
    this.storageService = config.storageService;
    this.storageBrowserService = config.storageBrowserService;
    this.performanceBrowserService = config.performanceBrowserService;
    this.dialog = config.dialog;
  }

  /**
   * 处理命令
   * 
   * @param command 用户输入的命令（以 "/" 开头）
   * @returns 是否处理了命令
   */
  async handleCommand(command: string): Promise<boolean> {
    const cmd = command.trim().toLowerCase();
    
    // 检查是否是命令
    if (!cmd.startsWith('/')) {
      return false;
    }

    // 解析命令和参数
    const parts = cmd.split(/\s+/);
    const mainCmd = parts[0];
    const args = parts.slice(1);

    switch (mainCmd) {
      case '/version':
        await this.showVersion(args);
        break;
      case '/task':
        await this.showTaskList();
        break;
      case '/schedule':
        await this.showScheduleList(args.join(' '));
        break;
      case '/store':
        await this.handleStore(args.join(' '));
        break;
      case '/perf':
        await this.handlePerf();
        break;
      case '/debug':
        await this.handleDebug(args);
        break;
      case '/help':
        await this.showCommandHelp();
        break;
      default:
        await this.renderMessage(`❌ 未知命令: ${mainCmd}\n\n输入 /help 查看可用命令`);
    }

    return true;
  }

  /**
   * 显示版本信息
   */
  /**
   * 显示版本信息
   */
  private async showVersion(args: string[] = []): Promise<void> {
    // 处理 upgrade 子命令
    if (args.length > 0 && args[0] === 'upgrade') {
      const upgradeType = args[1]?.toLowerCase();
      if (upgradeType === 'web') {
        await this.handleVersionUpgrade('web');
        return;
      } else if (upgradeType === 'app') {
        await this.handleVersionUpgrade('app');
        return;
      } else if (upgradeType === 'win') {
        await this.handleVersionUpgrade('win');
        return;
      } else {
        await this.renderMessage('❌ 未知的升级类型\n\n用法:\n- /version upgrade web - 刷新页面\n- /version upgrade app - 下载 Android APK\n- /version upgrade win - 下载 Windows 版本');
        return;
      }
    }

    // 默认：显示版本信息
    try {
      const versionInfo = await this.managementService.getVersion();
      const text = `📦 当前版本: ${versionInfo.version}`;
      await this.renderMessage(text);
    } catch (error) {
      console.error('[CommandHandler] Failed to get version:', error);
      await this.renderMessage('❌ 获取版本信息失败');
    }
  }

  /**
   * 处理版本升级
   * 
   * @param type 升级类型：web | app | win
   */
  private async handleVersionUpgrade(type: 'web' | 'app' | 'win'): Promise<void> {
    if (type === 'web') {
      await this.renderMessage('🔄 正在刷新页面...');
      setTimeout(() => window.location.reload(), 1000);
    } else if (type === 'app') {
      await this.renderMessage('📥 正在打开下载页面...\n\n请在浏览器中下载并安装 APK');
      window.open('https://bot.weiqi.lol/apk', '_blank');
    } else if (type === 'win') {
      await this.renderMessage('📥 正在打开下载页面...\n\n请在浏览器中下载并安装 Windows 版本');
      window.open('https://bot.weiqi.lol/win', '_blank');
    }
  }
  /**
   * 显示后台任务列表
   */
  private async showTaskList(): Promise<void> {
    const env = this.managementService.checkEnvironment();
    
    // 检查环境
    if (!env.canManageTasks) {
      await this.renderMessage('❌ 后台任务功能仅在 App 中可用');
      return;
    }

    try {
      const tasks = await this.managementService.getTaskList();
      
      let text: string;
      if (tasks.length === 0) {
        text = '📋 后台任务列表\n\n暂无后台任务';
      } else {
        text = `📋 后台任务列表\n\n`;
        for (const task of tasks) {
          text += `**任务 ID**: ${task.id}\n`;
          text += `- 状态: ${this.managementService.formatTaskStatus(task.status)}\n`;
          text += `- 进度: ${task.progress || 0}%\n`;
          if (task.progressMessage) {
            text += `- 详情: ${task.progressMessage}\n`;
          }
          text += `\n`;
        }
      }
      
      await this.renderMessage(text);
    } catch (error) {
      console.error('[CommandHandler] Failed to list tasks:', error);
      await this.renderMessage(`❌ 查询任务列表失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 显示定时计划列表
   * 
   * @param action 操作类型：delete <scheduleId> | result <scheduleId>
   */
  private async showScheduleList(action?: string): Promise<void> {
    const env = this.managementService.checkEnvironment();
    
    // 检查环境
    if (!env.canManageSchedules) {
      await this.renderMessage('❌ 定时任务功能仅在 App 中可用');
      return;
    }

    try {
      // 处理删除操作
      if (action && action.startsWith('delete ')) {
        const scheduleId = action.substring(7).trim();
        await this.managementService.deleteSchedule(scheduleId);
        await this.renderMessage(`✅ 已删除定时计划\n\n计划 ID: ${scheduleId}`);
      } else if (action && action.startsWith('result ')) {
        // 处理查看结果操作
        const scheduleId = action.substring(7).trim();
        await this.showScheduleResult(scheduleId);
      } else if (action && action.startsWith('run ')) {
        // 处理立即执行操作
        const scheduleId = action.substring(4).trim();
        await this.managementService.runScheduleNow(scheduleId);
        await this.renderMessage(`✅ 已立即执行定时计划\n\n计划 ID: ${scheduleId}`);
      } else {
        // 显示列表
        const schedules = await this.managementService.getScheduleList();
        
        let text: string;
        if (schedules.length === 0) {
          text = '📋 定时计划列表\n\n暂无定时计划';
        } else {
          text = `📋 定时计划列表（共 ${schedules.length} 个）\n\n`;
          for (const schedule of schedules) {
            const timeStr = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`;
            
            text += `**${schedule.id}**\n`;
            text += `├ 类型: ${schedule.type}\n`;
            text += `├ 频率: ${this.managementService.formatFrequency(schedule.frequency)}`;
            if (schedule.frequency === 'weekly' && schedule.dayOfWeek) {
              const weekDays = ['一', '二', '三', '四', '五', '六', '日'];
              text += `（周${weekDays[schedule.dayOfWeek - 1]}）`;
            } else if (schedule.frequency === 'monthly' && schedule.dayOfMonth) {
              text += `（${schedule.dayOfMonth}号）`;
            }
            text += `\n`;
            text += `├ 时间: ${timeStr}\n`;
            
            // 显示参数
            if (schedule.params && Object.keys(schedule.params).length > 0) {
              const paramStrs = Object.entries(schedule.params)
                .filter(([key]) => key !== 'text') // 过滤掉 text 参数
                .map(([key, value]) => `${key}=${value}`);
              if (paramStrs.length > 0) {
                text += `├ 参数: ${paramStrs.join(', ')}\n`;
              }
            }
            
            // 显示最后执行时间
            if (schedule.lastRunDate) {
              const lastRunTime = schedule.lastRunTime 
                ? new Date(schedule.lastRunTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                : '';
              text += `├ 最后执行: ${schedule.lastRunDate}${lastRunTime ? ` ${lastRunTime}` : ''}\n`;
            }
            
            // 操作链接
            text += `└ [▶️ 立即执行](schedule-run:${schedule.id})`;
            text += ` | [🗑️ 删除](schedule-delete:${schedule.id})`;
            if (schedule.lastResult) {
              text += ` | [📋 查看结果](schedule-result:${schedule.id})`;
            }
            text += `\n\n`;
          }
        }
        
        await this.renderMessage(text);
      }
    } catch (error) {
      console.error('[CommandHandler] Failed to handle schedule:', error);
      await this.renderMessage(`❌ 查询定时计划失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 显示定时计划执行结果详情
   */
  private async showScheduleResult(scheduleId: string): Promise<void> {
    try {
      const schedules = await this.managementService.getScheduleList();
      const schedule = schedules.find(s => s.id === scheduleId);
      
      if (!schedule) {
        await this.renderMessage(`❌ 未找到定时计划\n\n计划 ID: ${scheduleId}`);
        return;
      }
      
      if (!schedule.lastResult) {
        await this.renderMessage(`📋 暂无执行结果\n\n计划 ID: ${scheduleId}`);
        return;
      }
      
      const statusIcon = schedule.lastResult.status === 'completed' ? '✅' : '❌';
      const resultTime = schedule.lastResult.completedAt 
        ? new Date(schedule.lastResult.completedAt).toLocaleString('zh-CN')
        : '';
      
      let text = `📋 执行结果详情\n\n`;
      text += `**计划**: ${scheduleId}\n`;
      text += `**状态**: ${statusIcon} ${schedule.lastResult.status === 'completed' ? '成功' : '失败'}\n`;
      text += `**标题**: ${schedule.lastResult.title || '完成'}\n`;
      if (resultTime) {
        text += `**时间**: ${resultTime}\n`;
      }
      text += `<br>`;
      if (schedule.lastResult.message) {
        text += schedule.lastResult.message;
      }
      
      await this.renderMessage(text);
    } catch (error) {
      console.error('[CommandHandler] Failed to show schedule result:', error);
      await this.renderMessage(`❌ 查询执行结果失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 显示命令帮助
   */
  private async showCommandHelp(): Promise<void> {
    const commands = this.managementService.getAvailableCommands();
    const env = this.managementService.checkEnvironment();
    
    let text = '📚 可用命令\n\n';
    
    // 基础命令
    const basicCommands = commands.filter(cmd => !cmd.appOnly);
    if (basicCommands.length > 0) {
      text += '**基础命令**\n';
      for (const cmd of basicCommands) {
        text += `- ${cmd.command}: ${cmd.description}\n`;
      }
      text += '\n';
    }
    
    // App 专属命令
    if (env.isApp) {
      const appCommands = commands.filter(cmd => cmd.appOnly);
      if (appCommands.length > 0) {
        text += '**任务管理**（仅 App 环境）\n';
        for (const cmd of appCommands) {
          text += `- ${cmd.command}: ${cmd.description}\n`;
        }
      }
    }
    
    await this.renderMessage(text);
  }

  /**
   * 处理存储命令
   * 
   * - /store: 显示存储概览
   * - /store ls [type]: 列出存储内容
   * - /store get <type> <key>: 获取存储值
   * - /store clear [type]: 清空指定存储
   */
  private async handleStore(action?: string): Promise<void> {
    // 如果有 StorageBrowserService，使用新实现
    if (this.storageBrowserService) {
      await this.handleStoreWithBrowser(action);
      return;
    }

    // 兼容旧实现（如果没有 StorageBrowserService）
    if (!this.storageService) {
      await this.renderMessage('❌ 存储服务不可用');
      return;
    }

    // 处理清空缓存操作
    if (action && action.startsWith('clear')) {
      try {
        await this.storageService.clearCache();
        
        // 清理成功后立即刷新页面，不等 renderMessage（避免其他代码访问已关闭的数据库）
        // App 环境：调用 prompt 通知 Android 刷新
        if (typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp')) {
          prompt('debug:refresh');
        } else {
          setTimeout(() => window.location.reload(), 100);
        }
      } catch (error) {
        // 如果只是 IndexedDB 关闭错误，忽略它并立即刷新
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('closed database') || errorMsg.includes('InvalidStateError')) {
          console.log('[CommandHandler] Cache cleared, refreshing...');
          if (typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp')) {
            try { prompt('debug:refresh'); } catch (e) {}
          } else {
            setTimeout(() => window.location.reload(), 100);
          }
          return;
        }
        
        console.error('[CommandHandler] Failed to clear cache:', error);
        try {
          await this.renderMessage(`❌ 清空缓存失败: ${errorMsg}`);
        } catch (e) {}
      }
      return;
    }

    // 显示存储概览
    try {
      const info = await this.storageService.getStorageInfo();
      
      // 检测是否在 App 环境（通过 userAgent）
      const isApp = typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp');
      
      let text = '## 💾 存储概览\n\n';
      text += '| 存储类型 | 大小 |\n';
      text += '|---------|------|\n';
      
      if (isApp) {
        // App 端：显示 App 存储 + Web 存储
        const detailedInfo = info as any; // DetailedStorageInfo
        text += `| App 内部存储 | ${this.storageService.formatSize(detailedInfo.appFilesSize || 0)} |\n`;
        text += `| App 缓存存储 | ${this.storageService.formatSize(detailedInfo.appCacheSize || 0)} |\n`;
        text += `| Web 浏览器缓存 | ${this.storageService.formatSize(info.cacheSize)} |\n`;
        text += `| Web IndexedDB | ${this.storageService.formatSize(info.idbSize)} |\n`;
        text += `| Web LocalStorage | ${this.storageService.formatSize(info.localStorageSize)} |\n`;
        text += `| Web SessionStorage | ${this.storageService.formatSize(info.sessionStorageSize)} |\n`;
      } else {
        // Web 端：只显示 Web 存储
        text += `| 浏览器缓存 | ${this.storageService.formatSize(info.cacheSize)} |\n`;
        text += `| IndexedDB | ${this.storageService.formatSize(info.idbSize)} |\n`;
        text += `| LocalStorage | ${this.storageService.formatSize(info.localStorageSize)} |\n`;
        text += `| SessionStorage | ${this.storageService.formatSize(info.sessionStorageSize)} |\n`;
      }
      
      text += `\n**总计**: ${this.storageService.formatSize(info.totalSize)}\n`;
      text += `<br>`;
      text += '[🗑️ 清空缓存](store-clear:cache)';
      
      await this.renderMessage(text);
    } catch (error) {
      console.error('[CommandHandler] Failed to get storage info:', error);
      await this.renderMessage(`❌ 查询存储信息失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 使用 StorageBrowserService 处理存储命令
   */
  private async handleStoreWithBrowser(action?: string): Promise<void> {
    if (!this.storageBrowserService) {
      await this.renderMessage('❌ 存储浏览服务不可用');
      return;
    }

    const parts = action?.split(/\s+/) || [];
    const subCmd = parts[0];

    try {
      switch (subCmd) {
        case 'ls':
          await this.handleStoreList(parts.slice(1));
          break;
        case 'get':
          await this.handleStoreGet(parts.slice(1));
          break;
        case 'clear':
          await this.handleStoreClear(parts.slice(1));
          break;
        case 'export':
          await this.handleStoreExport();
          break;
        case 'import':
          await this.handleStoreImport();
          break;
        default:
          // 显示概览
          const overview = await this.storageBrowserService.showOverview();
          await this.renderMessage(overview);
      }
    } catch (error) {
      console.error('[CommandHandler] Failed to handle store command:', error);
      await this.renderMessage(`❌ 执行存储命令失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 处理 /store ls 命令
   */
  private async handleStoreList(args: string[]): Promise<void> {
    if (!this.storageBrowserService) return;

    const type = args[0];
    const limit = this.parseArg(args, '--limit', 10);
    const offset = this.parseArg(args, '--offset', 0);

    switch (type) {
      case 'local':
        await this.renderMessage(await this.storageBrowserService.listLocalStorage());
        break;
      case 'session':
        await this.renderMessage(await this.storageBrowserService.listSessionStorage());
        break;
      case 'idb':
        if (args[1]) {
          if (args[2]) {
            // /store ls idb <dbname> <storename>
            await this.renderMessage(
              await this.storageBrowserService.listIndexedDBData(args[1], args[2], limit, offset)
            );
          } else {
            // /store ls idb <dbname>
            await this.renderMessage(
              await this.storageBrowserService.listIndexedDBObjectStores(args[1])
            );
          }
        } else {
          // /store ls idb
          await this.renderMessage(await this.storageBrowserService.listIndexedDB());
        }
        break;
      case 'cache':
        if (args[1]) {
          // /store ls cache <name>
          await this.renderMessage(
            await this.storageBrowserService.listCacheRequests(args[1], limit, offset)
          );
        } else {
          // /store ls cache
          await this.renderMessage(await this.storageBrowserService.listCacheStorage());
        }
        break;
      default:
        // 显示帮助
        let help = '📋 存储浏览命令\n\n';
        help += '**列出存储内容**\n';
        help += '- `/store ls local` - 列出 LocalStorage\n';
        help += '- `/store ls session` - 列出 SessionStorage\n';
        help += '- `/store ls idb [dbname] [store]` - 列出 IndexedDB\n';
        help += '- `/store ls cache [name]` - 列出 Cache Storage\n';
        help += '\n**分页参数**\n';
        help += '- `--limit <n>` - 每页显示条数（默认 10）\n';
        help += '- `--offset <n>` - 偏移量（默认 0）\n';
        await this.renderMessage(help);
    }
  }

  /**
   * 处理 /store get 命令
   */
  private async handleStoreGet(args: string[]): Promise<void> {
    if (!this.storageBrowserService) return;

    const type = args[0];

    switch (type) {
      case 'local':
        if (args[1]) {
          await this.renderMessage(
            await this.storageBrowserService.getLocalStorageItem(args[1])
          );
        } else {
          await this.renderMessage('❌ 请指定 key\n\n用法: `/store get local <key>`');
        }
        break;
      case 'session':
        if (args[1]) {
          await this.renderMessage(
            await this.storageBrowserService.getSessionStorageItem(args[1])
          );
        } else {
          await this.renderMessage('❌ 请指定 key\n\n用法: `/store get session <key>`');
        }
        break;
      case 'idb':
        if (args[1] && args[2] && args[3]) {
          // /store get idb <db> <store> <key>
          const key = this.parseKey(args[3]);
          await this.renderMessage(
            await this.storageBrowserService.getIndexedDBItem(args[1], args[2], key)
          );
        } else {
          await this.renderMessage(
            '❌ 参数不足\n\n用法: `/store get idb <dbname> <storename> <key>`'
          );
        }
        break;
      case 'cache':
        if (args[1] && args[2]) {
          // /store get cache <name> <url>
          await this.renderMessage(
            await this.storageBrowserService.getCacheResponse(args[1], args.slice(2).join(' '))
          );
        } else {
          await this.renderMessage(
            '❌ 参数不足\n\n用法: `/store get cache <cacheName> <url>`'
          );
        }
        break;
      default:
        let help = '📋 获取存储值\n\n';
        help += '**命令格式**\n';
        help += '- `/store get local <key>` - 获取 LocalStorage 值\n';
        help += '- `/store get session <key>` - 获取 SessionStorage 值\n';
        help += '- `/store get idb <db> <store> <key>` - 获取 IndexedDB 值\n';
        help += '- `/store get cache <name> <url>` - 获取 Cache Storage 响应\n';
        await this.renderMessage(help);
    }
  }

  /**
   * 处理 /store clear 命令
   */
  private async handleStoreClear(args: string[]): Promise<void> {
    if (!this.storageBrowserService) return;

    const type = args[0];

    switch (type) {
      case 'local':
        await this.renderMessage(await this.storageBrowserService.clearLocalStorage());
        break;
      case 'session':
        await this.renderMessage(await this.storageBrowserService.clearSessionStorage());
        break;
      case 'idb':
        await this.renderMessage(await this.storageBrowserService.clearIndexedDB(args[1]));
        break;
      case 'cache':
        await this.renderMessage(await this.storageBrowserService.clearCacheStorage(args[1]));
        break;
      default:
        // 默认清空所有缓存
        const result = await this.storageBrowserService.clearAllCache();
        
        // 如果成功清空，立即刷新页面（不等 renderMessage，避免其他代码访问已关闭的数据库）
        if (result.includes('✅')) {
          if (typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp')) {
            try { prompt('debug:refresh'); } catch (e) {}
          } else {
            setTimeout(() => window.location.reload(), 100);
          }
          return;
        }
        await this.renderMessage(result);
    }
  }

  /**
   * 处理 /store export 命令
   */
  private async handleStoreExport(): Promise<void> {
    if (!this.storageBrowserService) return;
    const result = await this.storageBrowserService.exportUserData();
    await this.renderMessage(result);
  }

  /**
   * 处理 /store import 命令
   */
  private async handleStoreImport(): Promise<void> {
    if (!this.storageBrowserService) return;
    
    // 使用自定义对话框
    if (this.dialog) {
      const confirmed = await this.dialog.show({
        type: 'confirm',
        title: '导入用户数据',
        content: '导入会清空现有数据，是否继续？',
        confirmText: '确定',
        cancelText: '取消'
      });
      
      if (!confirmed) {
        await this.renderMessage('❌ 导入已取消');
        return;
      }
    } else {
      // fallback: 如果没有 dialog，使用浏览器 confirm
      const confirmed = confirm('导入会清空现有数据，是否继续？');
      if (!confirmed) {
        await this.renderMessage('❌ 导入已取消');
        return;
      }
    }
    
    const result = await this.storageBrowserService.importUserData();
    await this.renderMessage(result);
  }

  /**
   * 解析命令参数
   */
  private parseArg(args: string[], flag: string, defaultValue: number): number {
    const index = args.indexOf(flag);
    if (index !== -1 && index + 1 < args.length) {
      const nextArg = args[index + 1];
      const value = nextArg ? parseInt(nextArg, 10) : defaultValue;
      return isNaN(value) ? defaultValue : value;
    }
    return defaultValue;
  }

  /**
   * 解析 key 参数（支持数字和字符串）
   */
  private parseKey(keyStr: string): any {
    // 尝试解析为数字
    const num = parseInt(keyStr, 10);
    if (!isNaN(num)) {
      return num;
    }
    // 尝试解析为 JSON
    try {
      return JSON.parse(keyStr);
    } catch {
      // 返回原始字符串
      return keyStr;
    }
  }

  /**
   * 处理性能命令
   */
  private async handlePerf(): Promise<void> {
    // 检查环境
    const env = this.managementService.checkEnvironment();
    if (!env.isApp) {
      await this.renderMessage('❌ 性能监控功能仅在 App 中可用');
      return;
    }

    // 检查服务是否可用
    if (!this.performanceBrowserService) {
      await this.renderMessage('❌ 性能服务不可用');
      return;
    }

    try {
      const result = await this.performanceBrowserService.showOverview();
      await this.renderMessage(result);
    } catch (error) {
      console.error('[CommandHandler] Failed to handle perf:', error);
      await this.renderMessage(`❌ 查询性能信息失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 处理调试命令
   * 
   * - /debug: 打开调试日志页面（3秒倒计时跳转）
   * - /debug on: 开启 katago 调试
   * - /debug off: 关闭 katago 调试
   */
  private async handleDebug(args: string[]): Promise<void> {
    const action = args[0]?.toLowerCase();
    
    if (action === 'on') {
      localStorage.setItem('KATAGO_DEBUG', 'true');
      await this.renderMessage('🐛 调试模式已开启\n\nKatago Worker 日志将被记录，可在调试页面查看');
    } else if (action === 'off') {
      localStorage.setItem('KATAGO_DEBUG', 'false');
      await this.renderMessage('🐛 调试模式已关闭');
    } else {
      // 默认：显示消息并倒计时跳转
      const actionUrl = '../debug/index.html';
      const actionText = '前往 调试日志';
      await this.renderMessage('🐛 即将打开调试日志页面', actionUrl, actionText);
      this.messageRenderer.showCountdownJump(actionUrl, 3, () => {
        // 用户取消跳转
        console.log('[CommandHandler] 用户取消了调试页面跳转');
      });
    }
  }

  /**
   * 渲染消息并保存历史
   */
  private async renderMessage(content: string, actionUrl?: string, actionText?: string): Promise<void> {
    await this.messageRenderer.renderMessage(content, false, null, null, actionUrl, actionText);
    
    const message: any = {
      role: 'assistant',
      content,
    };
    
    // 只有在有值时才添加这些属性
    if (actionUrl) message.actionUrl = actionUrl;
    if (actionText) message.actionText = actionText;
    
    await this.chatHistoryManager.addMessage(message);
  }
}
