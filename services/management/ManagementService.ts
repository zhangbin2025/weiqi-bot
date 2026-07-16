/**
 * 管理服务实现
 * @module services/management/ManagementService
 */

import type { NetworkManager } from '../../infrastructure/network/core/NetworkManager';
import type { IConfigProvider } from '../../infrastructure/config/interfaces/IConfigProvider';
import type { TaskStatus } from '../../domain/task/types';
import type { ScheduleConfig } from '../../domain/schedule/ScheduleManager';
import type {
  IManagementService,
  VersionInfo,
  EnvironmentStatus,
  ManagementCommand,
  MANAGEMENT_COMMANDS,
} from './IManagementService';
import type { IManagementConfig } from '../../infrastructure/config/schemas/ManagementConfigSchema';
import { MANAGEMENT_COMMANDS as COMMANDS } from './IManagementService';

/**
 * 管理服务配置
 */
export interface ManagementServiceConfig {
  network?: NetworkManager;
  configProvider?: IConfigProvider;
  /** 直接指定 versionUrl（优先级高于配置和默认值） */
  versionUrl?: string;
}

/**
 * 管理服务实现
 */
export class ManagementService implements IManagementService {
  private network?: NetworkManager | undefined;
  private configProvider?: IConfigProvider | undefined;
  private versionUrlOverride?: string | undefined;
  private cachedEnv: EnvironmentStatus | null = null;

  constructor(config: ManagementServiceConfig = {}) {
    this.network = config.network;
    this.configProvider = config.configProvider;
    this.versionUrlOverride = config.versionUrl;
  }
  
  /**
   * 获取 version.json 的 URL
   * 
   * 优先级：
   * 1. 直接指定的 versionUrlOverride
   * 2. 配置中的 versionUrl
   * 3. 根据环境自动判断（Web 端用相对路径，App 端用本地路径）
   */
  private async getVersionUrl(): Promise<string> {
    // 优先使用直接指定的 URL
    if (this.versionUrlOverride) {
      return this.versionUrlOverride;
    }
    
    // 从配置中获取
    if (this.configProvider) {
      const config = await this.configProvider.getModuleConfig<IManagementConfig>('management');
      if (config.versionUrl) {
        return config.versionUrl;
      }
    }
    
    // 根据环境自动判断
    const isApp = typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp');
    
    if (isApp) {
      // App 环境：使用本地路径
      return '/version.json';
    } else {
      // Web 环境：使用相对路径（支持子目录部署）
      // assistant/index.html 的相对路径是 ../version.json
      return '../version.json';
    }
  }

  /**
   * 获取版本信息
   */
  async getVersion(): Promise<VersionInfo> {
    try {
      const versionUrl = await this.getVersionUrl();
      let data: { version?: string; buildTime?: string };
      
      if (this.network) {
        // 使用 NetworkManager
        const response = await this.network.request<{ version?: string; buildTime?: string }>({
          url: versionUrl,
          method: 'GET',
          responseType: 'json',
        });
        data = response.data;
      } else {
        // 使用原生 fetch
        const response = await fetch(versionUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        data = await response.json();
      }

      return {
        version: data.version || '未知',
        buildTime: data.buildTime,
      };
    } catch (error) {
      console.error('[ManagementService] Failed to get version:', error);
      return {
        version: '未知',
      };
    }
  }

  /**
   * 获取后台任务列表
   */
  async getTaskList(): Promise<TaskStatus[]> {
    if (!this.checkEnvironment().taskBridgeAvailable) {
      return [];
    }

    try {
      const tasks = await window.TaskBridge!.listTasks();
      return tasks || [];
    } catch (error) {
      console.error('[ManagementService] Failed to list tasks:', error);
      return [];
    }
  }

  /**
   * 获取定时计划列表
   */
  async getScheduleList(): Promise<ScheduleConfig[]> {
    if (!this.checkEnvironment().taskBridgeAvailable) {
      return [];
    }

    try {
      const schedules = await window.TaskBridge!.listSchedules();
      return schedules || [];
    } catch (error) {
      console.error('[ManagementService] Failed to list schedules:', error);
      return [];
    }
  }

  /**
   * 删除定时计划
   */
  async deleteSchedule(scheduleId: string): Promise<void> {
    if (!this.checkEnvironment().taskBridgeAvailable) {
      throw new Error('定时计划功能仅在 App 中可用');
    }

    try {
      await window.TaskBridge!.deleteSchedule(scheduleId);
    } catch (error) {
      console.error('[ManagementService] Failed to delete schedule:', error);
      throw error;
    }
  }

  /**
   * 立即执行定时计划
   */
  async runScheduleNow(scheduleId: string): Promise<void> {
    if (!this.checkEnvironment().taskBridgeAvailable) {
      throw new Error('定时计划功能仅在 App 中可用');
    }

    try {
      await window.TaskBridge!.runScheduleNow(scheduleId);
    } catch (error) {
      console.error('[ManagementService] Failed to run schedule:', error);
      throw error;
    }
  }

  /**
   * 检查环境状态
   */
  checkEnvironment(): EnvironmentStatus {
    // 缓存环境状态（不会在运行时改变）
    if (this.cachedEnv) {
      return this.cachedEnv;
    }

    const isApp = this.isAppEnvironment();
    const taskBridgeAvailable = typeof window.TaskBridge !== 'undefined';

    this.cachedEnv = {
      isApp,
      taskBridgeAvailable,
      canManageTasks: isApp && taskBridgeAvailable,
      canManageSchedules: isApp && taskBridgeAvailable,
    };

    return this.cachedEnv;
  }

  /**
   * 获取可用命令列表（根据环境过滤）
   */
  getAvailableCommands(): ManagementCommand[] {
    const env = this.checkEnvironment();

    if (env.isApp) {
      // App 环境：所有命令可用
      return [...COMMANDS];
    } else {
      // Web 环境：只返回非 App 专属命令
      return COMMANDS.filter(cmd => !cmd.appOnly);
    }
  }

  /**
   * 检查是否在 App 环境中
   */
  private isAppEnvironment(): boolean {
    if (typeof navigator === 'undefined') {
      return false;
    }
    return navigator.userAgent.includes('WeiqiApp');
  }

  /**
   * 格式化任务状态
   */
  formatTaskStatus(status: string): string {
    const statusMap: Record<string, string> = {
      pending: '⏳ 等待中',
      running: '🔄 运行中',
      completed: '✅ 已完成',
      failed: '❌ 失败',
      cancelled: '🚫 已取消',
    };
    return statusMap[status] || status;
  }

  /**
   * 格式化频率
   */
  formatFrequency(frequency: string): string {
    const frequencyMap: Record<string, string> = {
      daily: '每天',
      weekly: '每周',
      monthly: '每月',
    };
    return frequencyMap[frequency] || frequency;
  }
}
