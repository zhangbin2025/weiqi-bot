import type { IConfigSchemaField } from '../interfaces/IConfigSchema';
/**
 * 平台配置适配器
 * @description 提供平台特定的默认配置
 */

import { Platform } from '../interfaces';
import type { IConfigSchemaDefinition } from '../interfaces';

/**
 * 平台配置适配器
 * @description 检测当前平台并提供平台特定的默认配置
 */
export class PlatformConfigAdapter {
  private platform: Platform;

  constructor() {
    this.platform = this.detectPlatform();
  }

  /**
   * 获取当前平台
   */
  getPlatform(): Platform {
    return this.platform;
  }

  /**
   * 检测当前平台
   */
  private detectPlatform(): Platform {
    // 检测浏览器环境
    if (typeof window !== 'undefined') {
      // 检测小程序环境
      if ((window as any).__wxjs_environment === 'miniprogram') {
        return Platform.MiniProgram;
      }
      // 检测 Electron 桌面应用
      if ((window as any).process?.versions?.electron) {
        return Platform.Desktop;
      }
      // 默认为 Web 浏览器
      return Platform.Web;
    }

    // 检测 Node.js 环境
    if (typeof process !== 'undefined') {
      // 检测 Electron 主进程
      if (process.versions?.['electron']) {
        return Platform.Desktop;
      }
      // 默认为服务端
      return Platform.Server;
    }

    // 默认为移动端（React Native 等）
    return Platform.Mobile;
  }

  /**
   * 获取平台默认配置
   * @param schema - 配置模式
   * @returns 平台默认配置
   */
  getPlatformDefaults<T>(schema: IConfigSchemaDefinition<T>): Partial<T> {
    const defaults: Partial<T> = {} as Partial<T>;

    for (const [key, field] of Object.entries(schema)) {
      // 检查是否有平台覆盖配置
      if ((field as IConfigSchemaField).platformOverrides && (field as IConfigSchemaField).platformOverrides![this.platform]) {
        (defaults as any)[key] = (field as IConfigSchemaField).platformOverrides![this.platform];
      }
    }

    return defaults;
  }

  /**
   * 应用平台配置
   * @param config - 原始配置
   * @param schema - 配置模式
   * @returns 应用平台配置后的配置
   */
  applyPlatformDefaults<T>(
    config: Partial<T>,
    schema: IConfigSchemaDefinition<T>
  ): T {
    const defaults = this.getPlatformDefaults(schema);
    return this.mergeConfigs(defaults, config) as T;
  }

  /**
   * 合并配置
   */
  private mergeConfigs<T>(base: Partial<T>, override: Partial<T>): Partial<T> {
    const result: Partial<T> = { ...base };

    for (const [key, value] of Object.entries(override)) {
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        (result as any)[key] &&
        typeof (result as any)[key] === 'object'
      ) {
        // 递归合并对象
        (result as any)[key] = this.mergeConfigs(
          (result as any)[key],
          value
        );
      } else {
        (result as any)[key] = value;
      }
    }

    return result;
  }
}
