/**
 * WebSocket 连接接口
 * @description 定义 WebSocket 连接的统一接口
 * @ai-example
 * const ws = await provider.connect('wss://example.com/live');
 * ws.onMessage((event) => {
 *   console.log('Received:', event.data);
 * });
 * ws.send('Hello');
 */

/**
 * WebSocket 连接状态
 */
export enum WebSocketReadyState {
  /** 正在连接 */
  CONNECTING = 0,

  /** 已连接 */
  OPEN = 1,

  /** 正在关闭 */
  CLOSING = 2,

  /** 已关闭 */
  CLOSED = 3
}

/**
 * WebSocket 事件
 */
export interface IWebSocketEvent {
  /** 事件数据 */
  data: string | ArrayBuffer;

  /** 事件类型 */
  type: 'message' | 'error' | 'close' | 'open';

  /** 时间戳 */
  timestamp?: number;
}

/**
 * WebSocket 配置选项
 */
export interface IWebSocketOptions {
  /** 连接超时（毫秒） */
  timeout?: number | undefined;

  /** 心跳间隔（毫秒） */
  heartbeatInterval?: number | undefined;

  /** 重连次数 */
  reconnectAttempts?: number | undefined;

  /** 重连延迟（毫秒） */
  reconnectDelay?: number | undefined;

  /** 子协议 */
  protocols?: (string | undefined)[];

  /** 自定义头（某些环境支持） */
  headers?: Record<string, string> | undefined;

  /** 自定义元数据 */
  metadata?: Record<string, unknown> | undefined;
}

/**
 * WebSocket 连接接口
 */
export interface IWebSocket {
  /** 连接状态 */
  readonly readyState: WebSocketReadyState;

  /** 连接 URL */
  readonly url: string;

  /** 发送消息
   * @param data - 消息数据
   */
  send(data: string | ArrayBuffer): void;

  /** 关闭连接 */
  close(): void;

  /**
   * 监听消息
   * @param callback - 消息回调函数
   */
  onMessage(callback: (event: IWebSocketEvent) => void): void;

  /**
   * 监听错误
   * @param callback - 错误回调函数
   */
  onError(callback: (error: Error) => void): void;

  /**
   * 监听关闭
   * @param callback - 关闭回调函数
   */
  onClose(callback: () => void): void;

  /**
   * 监听打开
   * @param callback - 打开回调函数
   */
  onOpen(callback: () => void): void;
}
