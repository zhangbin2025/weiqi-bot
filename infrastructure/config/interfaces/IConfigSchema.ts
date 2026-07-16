/**
 * 配置模式接口
 * @description 定义配置的结构、类型、约束、默认值
 */

import type {
  ConfigFieldType,
  ConfigValidatorFn,
  Platform,
} from './types';

/**
 * 配置字段定义
 * @description 定义单个配置字段的结构和约束
 */
export interface IConfigSchemaField<T = unknown> {
  /** 字段类型 */
  type: ConfigFieldType;

  /** 默认值 */
  default?: T;

  /** 默认值（别名） */
  defaultValue?: T;

  /** 是否必填 */
  required?: boolean;

  /** 字段描述 */
  description?: string;

  /** 验证函数 */
  validate?: ConfigValidatorFn<T>;

  /** 枚举值（type 为 'enum' 时使用） */
  enumValues?: T[];

  /** 嵌套字段（type 为 'object' 时使用） */
  properties?: IConfigSchemaDefinition<T>;

  /** 数组元素类型（type 为 'array' 时使用） */
  items?: IConfigSchemaField<unknown>;

  /** 平台覆盖配置 */
  platformOverrides?: Partial<Record<Platform, T>>;

  /** 最小值（type 为 'number' 时使用） */
  minValue?: number;

  /** 最大值（type 为 'number' 时使用） */
  maxValue?: number;

  /** 最小长度（type 为 'string' 或 'array' 时使用） */
  minLength?: number;

  /** 最大长度（type 为 'string' 或 'array' 时使用） */
  maxLength?: number;
}

/**
 * 配置模式定义
 * @description 定义完整配置对象的结构
 * @ai-example
 * const schema: IConfigSchemaDefinition<IStorageConfig> = {
 *   namespace: {
 *     type: 'string',
 *     default: 'weiqi',
 *     required: true
 *   }
 * };
 */
export type IConfigSchemaDefinition<T = unknown> = {
  [K in keyof T]: IConfigSchemaField<T[K]>;
};

/**
 * 配置模式注册表
 * @description 管理所有模块的配置模式
 */
export interface IConfigSchemaRegistry {
  /**
   * 注册配置模式
   * @param module - 模块名
   * @param schema - 配置模式
   */
  registerSchema<T>(module: string, schema: IConfigSchemaDefinition<T>): void;

  /**
   * 获取配置模式
   * @param module - 模块名
   * @returns 配置模式
   */
  getSchema<T>(module: string): IConfigSchemaDefinition<T>;

  /**
   * 检查配置模式是否存在
   * @param module - 模块名
   */
  hasSchema(module: string): boolean;

  /**
   * 获取所有已注册的模块名
   */
  getAllModules(): string[];
}
