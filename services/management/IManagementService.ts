/**
 * 管理服务接口
 * @module services/management/IManagementService
 */

import type { TaskStatus } from '../../domain/task/types';
import type { ScheduleConfig } from '../../domain/schedule/ScheduleManager';

/**
 * 版本信息
 */
export interface VersionInfo {
  version: string;
  buildTime?: string | undefined;
}

/**
 * 环境状态
 */
export interface EnvironmentStatus {
  /** 是否在 App 环境中 */
  isApp: boolean;
  /** TaskBridge 是否可用 */
  taskBridgeAvailable: boolean;
  /** 是否可以管理任务 */
  canManageTasks: boolean;
  /** 是否可以管理定时计划 */
  canManageSchedules: boolean;
}

/**
 * 管理服务接口
 */
export interface IManagementService {
  /**
   * 获取版本信息
   */
  getVersion(): Promise<VersionInfo>;

  /**
   * 获取后台任务列表
   */
  getTaskList(): Promise<TaskStatus[]>;

  /**
   * 获取定时计划列表
   */
  getScheduleList(): Promise<ScheduleConfig[]>;

  /**
   * 删除定时计划
   */
  deleteSchedule(scheduleId: string): Promise<void>;

  /**
   * 立即执行定时计划
   */
  runScheduleNow(scheduleId: string): Promise<void>;

  /**
   * 检查环境状态
   */
  checkEnvironment(): EnvironmentStatus;

  /**
   * 获取可用命令列表（根据环境过滤）
   */
  getAvailableCommands(): ManagementCommand[];

  /**
   * 格式化任务状态
   */
  formatTaskStatus(status: string): string;

  /**
   * 格式化频率
   */
  formatFrequency(frequency: string): string;
}

/**
 * 管理命令定义
 */
export interface ManagementCommand {
  /** 命令名称（如 /version） */
  command: string;
  /** 显示标题 */
  title: string;
  /** 图标 */
  icon: string;
  /** 描述 */
  description: string;
  /** 是否仅 App 可用 */
  appOnly: boolean;
}

/**
 * 预定义的管理命令列表
 */
export const MANAGEMENT_COMMANDS: ManagementCommand[] = [
  {
    command: '/version',
    title: '版本信息',
    icon: '📦',
    description: '显示当前版本',
    appOnly: false,
  },
  {
    command: '/task',
    title: '后台任务',
    icon: '📋',
    description: '显示后台任务列表',
    appOnly: true,
  },
  {
    command: '/schedule',
    title: '定时计划',
    icon: '⏰',
    description: '显示定时计划列表（支持 delete 删除）',
    appOnly: true,
  },
  {
    command: '/debug',
    title: '调试日志',
    icon: '🐛',
    description: '打开调试日志页面，支持 on/off 开关',
    appOnly: false,
  },
  {
    command: '/store',
    title: '存储管理',
    icon: '💾',
    description: '显示存储概览，支持 clear 清空缓存',
    appOnly: false,
  },
  {
    command: '/perf',
    title: '性能监控',
    icon: '📊',
    description: '显示内存、系统等性能数据',
    appOnly: true,
  },
  {
    command: '/help',
    title: '帮助',
    icon: '📚',
    description: '显示可用命令',
    appOnly: false,
  },
];
