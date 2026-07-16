import type { IPlatformAdapter } from '../../interfaces/IPlatformAdapter';
import type { IWebViewSession } from '../../interfaces/IWebViewSession';
import type { WebViewOptions } from '../../interfaces/PlatformTypes';

/**
 * WebView 适配器接口
 * @description 用于移动端 WebView 数据拦截
 * 
 * @ai-example
 * ```typescript
 * const adapter = new ReactNativeAdapter();
 * 
 * if (adapter.isCurrentPlatform() && adapter.supportsWebSocketHook()) {
 *   const session = await adapter.loadUrl('https://game.example.com', {
 *     hookWebSocket: true,
 *     hookHttp: true
 *   });
 * }
 * ```
 */
export interface IWebViewAdapter extends IPlatformAdapter {
  /** 加载 URL 并注入 Hook */
  loadUrl(url: string, options?: WebViewOptions): Promise<IWebViewSession>;

  /** 是否支持 WebSocket Hook */
  supportsWebSocketHook(): boolean;

  /** 是否支持 HTTP Hook */
  supportsHttpHook(): boolean;
}
