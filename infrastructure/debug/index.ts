/**
 * 调试基础设施
 * @module infrastructure/debug
 */

import { PlatformDetector } from '../../presentation/adapters/PlatformDetector';
import { AndroidDebugAdapter } from './adapters/AndroidDebugAdapter';
import { WebDebugAdapter } from './adapters/WebDebugAdapter';
import type { IDebugAdapter } from './adapters/IDebugAdapter';

export * from './adapters/IDebugAdapter';
export * from './adapters/AndroidDebugAdapter';
export * from './adapters/WebDebugAdapter';

/**
 * 创建调试适配器
 * 根据当前平台自动选择合适的适配器
 */
export function createDebugAdapter(): IDebugAdapter {
  // 检测是否在 Android App 中（通过 userAgent）
  if (navigator.userAgent.includes('WeiqiApp')) {
    return new AndroidDebugAdapter();
  }
  
  // 默认使用 Web 适配器
  return new WebDebugAdapter();
}
