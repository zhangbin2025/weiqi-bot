/**
 * 环境检测器
 * @description 检测当前运行环境
 * @ai-example
 * const detector = new EnvironmentDetector();
 * const env = detector.detect();
 * console.log(env); // Environment.WEB
 */

import { Environment, IEnvironmentDetector } from '../interfaces';

/** 扩展的 Window 接口，用于环境检测 */
interface IExtendedWindow {
  electronAPI?: unknown;
  wx?: { getSystemInfoSync(): unknown };
  my?: { getSystemInfoSync(): unknown };
  __TAURI__?: unknown;
  __WEIQI_APP__?: unknown;
  chrome?: unknown;
}

/** 扩展的 Process Versions 接口 */
interface IExtendedProcessVersions {
  electron?: string;
}



/**
 * 环境检测器实现
 */
export class EnvironmentDetector implements IEnvironmentDetector {
  /**
   * 检测当前运行环境
   */
  detect(): Environment {
    // 检测浏览器环境
    if (typeof window !== 'undefined') {
      // 检测 Electron 环境
      if (this.isElectron()) {
        return Environment.DESKTOP;
      }

      // 检测小程序环境
      if (this.isMiniProgram()) {
        return Environment.MINIPROGRAM;
      }

      // 默认为 Web 环境
      return Environment.WEB;
    }

    // 检测 Node.js 环境
    if (typeof process !== 'undefined' && process.versions?.node) {
      return Environment.BACKEND;
    }

    // 检测 React Native 环境
    if (this.isReactNative()) {
      return Environment.MOBILE;
    }

    // 默认返回 Web 环境
    return Environment.WEB;
  }

  /**
   * 检测是否为 Electron 环境
   */
  private isElectron(): boolean {
    if (typeof window !== 'undefined') {
      const win = window as IExtendedWindow;

      // Electron 通常会注入 electronAPI
      if (win.electronAPI) {
        return true;
      }

      // 或者检测 process.versions.electron
      if (
        typeof process !== 'undefined' &&
        process.versions &&
        (process.versions as IExtendedProcessVersions).electron
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * 检测是否为小程序环境
   */
  private isMiniProgram(): boolean {
    if (typeof window !== 'undefined') {
      const win = window as IExtendedWindow;

      // 微信小程序
      if ('getSystemInfoSync' in (win.wx ?? {})) {
        return true;
      }

      // 支付宝小程序
      if ('getSystemInfoSync' in (win.my ?? {})) {
        return true;
      }
    }

    return false;
  }

  /**
   * 检测是否为 React Native 环境
   */
  private isReactNative(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      navigator.product === 'ReactNative'
    );
  }
}
