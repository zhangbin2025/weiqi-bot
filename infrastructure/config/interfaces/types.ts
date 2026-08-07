/**
 * 配置模块基础类型定义
 * @description 定义配置系统使用的枚举和基础类型
 */

/**
 * 平台类型
 * @description 支持的运行平台
 */
export enum Platform {
  /** Web 浏览器 */
  Web = 'web',
  /** 小程序 */
  MiniProgram = 'miniprogram',
  /** 移动端（Android/iOS） */
  Mobile = 'mobile',
  /** 桌面应用（Electron） */
  Desktop = 'desktop',
  /** 服务端（Node.js） */
  Server = 'server',
}

/**
 * 模块状态
 * @description 模块的生命周期状态
 */
export enum ModuleStatus {
  /** 未初始化 */
  Uninitialized = 'uninitialized',
  /** 初始化中 */
  Initializing = 'initializing',
  /** 就绪 */
  Ready = 'ready',
  /** 错误 */
  Error = 'error',
  /** 已销毁 */
  Destroyed = 'destroyed',
}

/**
 * 应用状态
 * @description 应用的生命周期状态
 */
export enum ApplicationStatus {
  /** 空闲（未启动） */
  Idle = 'idle',
  /** 启动中 */
  Starting = 'starting',
  /** 运行中 */
  Running = 'running',
  /** 停止中 */
  Stopping = 'stopping',
  /** 已停止 */
  Stopped = 'stopped',
}

/**
 * 配置字段类型
 * @description 配置值支持的数据类型
 */
export type ConfigFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'enum';

/**
 * 配置键
 * @description 配置的键名，支持点号分隔的路径
 * @ai-example 'storage.defaultNamespace' 或 'network.timeout'
 */
export type ConfigKey = string;

/**
 * 配置命名空间
 * @description 配置的命名空间，用于隔离不同模块的配置
 * @ai-example 'storage' 或 'network' 或 'global'
 */
export type ConfigNamespace = string;

/**
 * 配置值
 * @description 配置值可以是任意类型
 */
export type ConfigValue = unknown;

/**
 * 配置对象
 * @description 配置的键值对集合
 */
export type ConfigObject = Record<string, ConfigValue>;

/**
 * 配置变更监听器
 * @description 监听配置变更的回调函数
 */
export type ConfigChangeListener<T = ConfigValue> = (value: T) => void;

/**
 * 配置验证函数
 * @description 验证配置值是否有效
 */
export type ConfigValidatorFn<T = ConfigValue> = (value: T) => boolean;
