/**
 * 配置模块接口统一导出
 * @description 导出所有公开接口和类型定义
 */

// 基础类型
export type {
  ConfigFieldType,
  ConfigKey,
  ConfigNamespace,
  ConfigValue,
  ConfigObject,
  ConfigChangeListener,
  ConfigValidatorFn,
} from './types';

export {
  Platform,
  ModuleStatus,
  ApplicationStatus,
} from './types';

// 配置模式接口
export type {
  IConfigSchemaField,
  IConfigSchemaDefinition,
  IConfigSchemaRegistry,
} from './IConfigSchema';

// 配置提供者接口
export type { IConfigProvider } from './IConfigProvider';

// 配置存储接口
export type { IConfigStorage } from './IConfigStorage';

// IConfigurable 接口已简化为模块内部约定
