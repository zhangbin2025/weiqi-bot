import type { PlatformType, PlatformCapabilities } from './PlatformTypes';

/**
 * 平台适配器接口
 * @description 提供平台特定的能力（WebView、原生 API 等）
 * 
 * @ai-example
 * ```typescript
 * class WebAdapter implements IPlatformAdapter {
 *   readonly name = 'web';
 *   readonly displayName = 'Web Browser';
 *   
 *   isCurrentPlatform() {
 *     return typeof window !== 'undefined' && !window.ReactNativeWebView;
 *   }
 *   
 *   getCapabilities() {
 *     return { webview: false, playwright: false, ... };
 *   }
 * }
 * ```
 */
export interface IPlatformAdapter {
  /** 平台名称 */
  readonly name: PlatformType;

  /** 平台显示名称 */
  readonly displayName: string;

  /** 检测当前是否在此平台 */
  isCurrentPlatform(): boolean;

  /** 获取平台能力 */
  getCapabilities(): PlatformCapabilities;
}
