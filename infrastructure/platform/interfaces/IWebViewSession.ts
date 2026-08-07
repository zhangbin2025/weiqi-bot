import type { WebSocketMessage, HttpResponseData } from './PlatformTypes';

/**
 * WebView 会话接口
 * @description 管理单个 WebView 会话的生命周期和数据拦截
 * 
 * @ai-example
 * ```typescript
 * const session = await adapter.loadUrl('https://example.com', {
 *   hookWebSocket: true,
 *   hookHttp: true
 * });
 * 
 * const unsub = session.onWebSocketMessage((msg) => {
 *   console.log('WS:', msg.direction, msg.data);
 * });
 * 
 * session.close();
 * ```
 */
export interface IWebViewSession {
  /** URL */
  readonly url: string;

  /** 会话 ID */
  readonly sessionId: string;

  /** 监听 WebSocket 消息 */
  onWebSocketMessage(callback: (data: WebSocketMessage) => void): () => void;

  /** 监听 HTTP 响应 */
  onHttpResponse(callback: (data: HttpResponseData) => void): () => void;

  /** 监听页面变量变化 */
  onVariableChange(name: string, callback: (value: unknown) => void): () => void;

  /** 执行 JavaScript */
  evaluateJavaScript(script: string): Promise<unknown>;

  /** 获取页面变量 */
  getVariable(name: string): Promise<unknown>;

  /** 关闭会话 */
  close(): Promise<void>;
}
