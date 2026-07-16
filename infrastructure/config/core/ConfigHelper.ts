import type { IConfigSchemaField } from '../interfaces/IConfigSchema';
/**
 * 配置辅助方法
 */

import type { IConfigSchemaDefinition, ConfigObject } from '../interfaces';

export class ConfigHelper {
  static getDefaultConfig(schema: IConfigSchemaDefinition<unknown>): ConfigObject {
    const config: ConfigObject = {};
    for (const [key, field] of Object.entries(schema)) {
      if ((field as IConfigSchemaField).default !== undefined) {
        config[key] = (field as IConfigSchemaField).default;
      }
    }
    return config;
  }

  static mergeConfigs(base: ConfigObject, override: ConfigObject): ConfigObject {
    const result: ConfigObject = { ...base };
    for (const [key, value] of Object.entries(override)) {
      if (value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object') {
        result[key] = this.mergeConfigs(result[key] as ConfigObject, value as ConfigObject);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  static getNestedValue(obj: ConfigObject, path: string): unknown {
    const keys = path.split('.');
    let value: unknown = obj;
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = (value as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }
    return value;
  }
}
