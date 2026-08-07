import type { IPlatformAdapter } from '../../interfaces/IPlatformAdapter';

/**
 * Electron 适配器接口（预留）
 * @description 用于 Electron 环境的平台适配
 * 
 * @ai-example
 * ```typescript
 * // 预留接口，待实现
 * interface IElectronAdapter extends IPlatformAdapter {
 *   // Electron 特有能力
 *   createBrowserWindow(options?: BrowserWindowOptions): Promise<void>;
 * }
 * ```
 */
export interface IElectronAdapter extends IPlatformAdapter {
  // Electron 特有能力（待定义）
}