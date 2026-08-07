import type { IWebViewAdapter, IWebViewSession, WebViewOptions, WebSocketMessage, HttpResponseData } from '../../interfaces';
import type { PlatformCapabilities, PlatformType } from '../../interfaces/PlatformTypes';
import { PlatformDetector } from '../../core/PlatformDetector';
import { WEBSOCKET_HOOK_SCRIPT, HTTP_HOOK_SCRIPT } from './hooks';

/**
 * 小程序 WebView 适配器（微信/支付宝）
 * 
 * 使用方式：配合小程序 web-view 组件
 * 
 * @ai-example
 * ```xml
 * <!-- 微信小程序 -->
 * <web-view src="{{url}}" bindmessage="onMessage"></web-view>
 * 
 * // JS
 * const adapter = new MiniProgramAdapter('wechat');
 * const session = await adapter.loadUrl(url);
 * 
 * Page({
 *   onMessage(e) {
 *     session.handleNativeMessage(e.detail.data);
 *   }
 * });
 * ```
 */
export class MiniProgramAdapter implements IWebViewAdapter {
  readonly name: PlatformType;
  readonly displayName: string;
  private platform: 'wechat' | 'alipay';

  constructor(platform: 'wechat' | 'alipay' = 'wechat') {
    this.platform = platform;
    this.name = platform === 'wechat' ? 'miniprogram-wechat' : 'miniprogram-alipay';
    this.displayName = platform === 'wechat' ? '微信小程序' : '支付宝小程序';
  }

  isCurrentPlatform(): boolean {
    return PlatformDetector.detect() === this.name;
  }

  getCapabilities(): PlatformCapabilities {
    return PlatformDetector.getCapabilities(this.name);
  }

  supportsWebSocketHook(): boolean {
    return true;
  }

  supportsHttpHook(): boolean {
    return true;
  }

  async loadUrl(url: string, options?: WebViewOptions): Promise<IWebViewSession> {
    return new MiniProgramWebViewSession(url, this.platform, options);
  }
}

/**
 * 小程序 WebView 会话
 */
class MiniProgramWebViewSession implements IWebViewSession {
  readonly url: string;
  readonly sessionId: string;
  
  private wsCallbacks: Map<string, (data: WebSocketMessage) => void> = new Map();
  private httpCallbacks: Map<string, (data: HttpResponseData) => void> = new Map();
  private closed = false;
  private platform: 'wechat' | 'alipay';

  constructor(url: string, platform: 'wechat' | 'alipay', private options?: WebViewOptions) {
    this.url = url;
    this.platform = platform;
    this.sessionId = `miniprogram-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  /**
   * 获取注入脚本（供 web-view 页面使用）
   * 注意：小程序 web-view 不支持 injectedJavaScript，需在页面内注入
   */
  getInjectedScript(): string {
    const scripts: string[] = [];
    
    if (this.options?.hookWebSocket) {
      scripts.push(WEBSOCKET_HOOK_SCRIPT);
    }
    
    if (this.options?.hookHttp) {
      scripts.push(HTTP_HOOK_SCRIPT);
    }
    
    if (this.options?.injectedScripts) {
      scripts.push(...this.options.injectedScripts);
    }
    
    return scripts.join('\n\n');
  }

  onWebSocketMessage(callback: (data: WebSocketMessage) => void): () => void {
    const id = Math.random().toString(36);
    this.wsCallbacks.set(id, callback);
    return () => this.wsCallbacks.delete(id);
  }

  onHttpResponse(callback: (data: HttpResponseData) => void): () => void {
    const id = Math.random().toString(36);
    this.httpCallbacks.set(id, callback);
    return () => this.httpCallbacks.delete(id);
  }

  onVariableChange(name: string, callback: (value: unknown) => void): () => void {
    // 小程序 web-view 无法直接轮询，需要通过 postMessage 传递
    const interval = setInterval(() => {
      if (this.closed) {
        clearInterval(interval);
        return;
      }
      // 需要在页面内定期发送变量值
    }, 1000);
    
    return () => clearInterval(interval);
  }

  /**
   * 处理小程序 web-view 发回的消息
   * 
   * 微信小程序：e.detail.data（数组）
   * 支付宝小程序：e.detail.data（单个值）
   */
  handleNativeMessage(data: any): void {
    // 微信小程序返回的是数组
    const messages = Array.isArray(data) ? data : [data];
    
    for (const rawMessage of messages) {
      try {
        const msg = typeof rawMessage === 'string' ? JSON.parse(rawMessage) : rawMessage;
        
        if (msg.type === 'ws_message' || msg.type === 'ws_send') {
          this.wsCallbacks.forEach(cb => cb(msg.data));
        } else if (msg.type === 'http_response') {
          this.httpCallbacks.forEach(cb => cb(msg.data));
        }
      } catch (e) {
        // 忽略无效消息
      }
    }
  }

  async evaluateJavaScript(_script: string): Promise<unknown> {
    // 小程序 web-view 无法直接执行 JS
    // 需要通过 postMessage 通信
    return { needsPostMessage: true };
  }

  async getVariable(name: string): Promise<unknown> {
    // 需要在页面内主动发送变量值
    return {
      needsPostMessage: true,
      variableName: name,
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.wsCallbacks.clear();
    this.httpCallbacks.clear();
  }
}
