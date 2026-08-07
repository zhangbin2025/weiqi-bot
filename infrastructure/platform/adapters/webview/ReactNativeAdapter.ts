import type { IWebViewAdapter, IWebViewSession, WebViewOptions, WebSocketMessage, HttpResponseData } from '../../interfaces';
import type { PlatformCapabilities } from '../../interfaces/PlatformTypes';
import { PlatformDetector } from '../../core/PlatformDetector';
import { WEBSOCKET_HOOK_SCRIPT, HTTP_HOOK_SCRIPT } from './hooks';

/**
 * React Native WebView 适配器
 * 
 * 使用方式：配合 react-native-webview 组件
 * 
 * @ai-example
 * ```tsx
 * import { WebView } from 'react-native-webview';
 * import { ReactNativeAdapter } from './infrastructure/platform';
 * 
 * const adapter = new ReactNativeAdapter();
 * const session = await adapter.loadUrl('https://example.com', {
 *   hookWebSocket: true,
 *   hookHttp: true
 * });
 * 
 * <WebView
 *   source={{ uri: session.url }}
 *   injectedJavaScript={session.getInjectedScript()}
 *   onMessage={(event) => session.handleNativeMessage(event.nativeEvent.data)}
 * />
 * ```
 */
export class ReactNativeAdapter implements IWebViewAdapter {
  readonly name = 'react-native' as const;
  readonly displayName = 'React Native';

  isCurrentPlatform(): boolean {
    return PlatformDetector.detect() === 'react-native';
  }

  getCapabilities(): PlatformCapabilities {
    return PlatformDetector.getCapabilities('react-native');
  }

  supportsWebSocketHook(): boolean {
    return true;
  }

  supportsHttpHook(): boolean {
    return true;
  }

  async loadUrl(url: string, options?: WebViewOptions): Promise<IWebViewSession> {
    return new ReactNativeWebViewSession(url, options);
  }
}

/**
 * React Native WebView 会话
 */
class ReactNativeWebViewSession implements IWebViewSession {
  readonly url: string;
  readonly sessionId: string;
  
  private wsCallbacks: Map<string, (data: WebSocketMessage) => void> = new Map();
  private httpCallbacks: Map<string, (data: HttpResponseData) => void> = new Map();
  private closed = false;

  constructor(url: string, private options?: WebViewOptions) {
    this.url = url;
    this.sessionId = `webview-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  /**
   * 获取注入脚本（供 WebView 组件使用）
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
    // 轮询实现
    const interval = setInterval(async () => {
      if (this.closed) {
        clearInterval(interval);
        return;
      }
      const value = await this.getVariable(name);
      callback(value);
    }, 500);
    
    return () => clearInterval(interval);
  }

  /**
   * 处理原生 WebView 发回的消息
   * 
   * 使用方式：
   * <WebView
   *   onMessage={(event) => session.handleNativeMessage(event.nativeEvent.data)}
   * />
   */
  handleNativeMessage(rawMessage: string): void {
    try {
      const msg = JSON.parse(rawMessage);
      
      if (msg.type === 'ws_message' || msg.type === 'ws_send') {
        this.wsCallbacks.forEach(cb => cb(msg.data));
      } else if (msg.type === 'http_response') {
        this.httpCallbacks.forEach(cb => cb(msg.data));
      }
    } catch (e) {
      // 忽略无效消息
    }
  }

  async evaluateJavaScript(script: string): Promise<unknown> {
    // 实际执行需要原生 WebView 支持
    // 这里返回脚本供外部执行
    return { script, needsNativeExecution: true };
  }

  async getVariable(name: string): Promise<unknown> {
    // 返回提取脚本
    return {
      script: `(function() { return window.${name}; })();`,
      needsNativeExecution: true,
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.wsCallbacks.clear();
    this.httpCallbacks.clear();
  }
}
