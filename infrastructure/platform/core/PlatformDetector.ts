import type { PlatformType, PlatformCapabilities } from '../interfaces';

/**
 * 平台检测器
 * @description 自动检测当前运行环境
 * 
 * @ai-example
 * ```typescript
 * const platform = PlatformDetector.detect();
 * console.log('Current platform:', platform);
 * 
 * const capabilities = PlatformDetector.getCapabilities(platform);
 * if (capabilities.webview) {
 *   console.log('WebView supported');
 * }
 * ```
 */
export class PlatformDetector {
  /**
   * 检测当前平台
   */
  static detect(): PlatformType {
    // Node.js 环境
    if (typeof process !== 'undefined' && process.versions?.node) {
      // Electron
      if (process.versions?.['electron']) {
        return 'electron';
      }
      return 'nodejs';
    }

    // 浏览器环境
    if (typeof window !== 'undefined') {
      // React Native
      if ((window as any).ReactNativeWebView) {
        return 'react-native';
      }

      // 微信小程序 web-view
      if ((window as any).wx?.miniProgram) {
        return 'miniprogram-wechat';
      }

      // 支付宝小程序 web-view
      if ((window as any).my?.miniProgram) {
        return 'miniprogram-alipay';
      }

      return 'web';
    }

    return 'nodejs';
  }

  /**
   * 获取平台能力
   */
  static getCapabilities(platform: PlatformType): PlatformCapabilities {
    switch (platform) {
      case 'nodejs':
        return {
          webview: false,
          playwright: true,
          nativeFS: true,
          nativeNetwork: true,
          canSpawnProcess: true,
        };

      case 'electron':
        return {
          webview: true,
          playwright: true,
          nativeFS: true,
          nativeNetwork: true,
          canSpawnProcess: true,
        };

      case 'react-native':
        return {
          webview: true,
          playwright: false,
          nativeFS: true,
          nativeNetwork: true,
          canSpawnProcess: false,
        };

      case 'miniprogram-wechat':
      case 'miniprogram-alipay':
        return {
          webview: true, // web-view 组件
          playwright: false,
          nativeFS: false,
          nativeNetwork: true,
          canSpawnProcess: false,
        };

      case 'web':
      default:
        return {
          webview: false,
          playwright: false,
          nativeFS: false,
          nativeNetwork: false,
          canSpawnProcess: false,
        };
    }
  }
}
