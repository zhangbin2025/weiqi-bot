/**
 * Sniffer 相关类型定义
 * @description 统一的抓包类型，支持 WebSocket、HTTP 等多种协议
 */

/**
 * Sniffer 消息类型
 */
export type SnifferMessageType =
  | 'ws_open'      // WebSocket 连接打开
  | 'ws_receive'   // WebSocket 接收消息
  | 'ws_send'      // WebSocket 发送消息
  | 'ws_close'     // WebSocket 连接关闭
  | 'http_request' // HTTP 请求
  | 'http_response'; // HTTP 响应

/**
 * WebSocket 消息数据
 */
export interface WsMessageData {
  /** 消息类型 */
  type: 'ws_open' | 'ws_receive' | 'ws_send' | 'ws_close';
  /** WebSocket URL */
  wsUrl: string;
  /** 消息内容（文本或 Base64 编码的二进制数据） */
  data?: string;
  /** 是否为二进制数据 */
  isBinary?: boolean;
  /** 时间戳（毫秒） */
  timestamp: number;
  /** 关闭码（仅 ws_close） */
  code?: number;
  /** 关闭原因（仅 ws_close） */
  reason?: string;
}

/**
 * HTTP 请求数据
 */
export interface HttpRequestData {
  /** 消息类型 */
  type: 'http_request';
  /** 请求 URL */
  url: string;
  /** HTTP 方法 */
  method: string;
  /** 请求头 */
  headers?: Record<string, string>;
  /** 请求体 */
  body?: string;
  /** 时间戳（毫秒） */
  timestamp: number;
}

/**
 * HTTP 响应数据
 */
export interface HttpResponseData {
  /** 消息类型 */
  type: 'http_response';
  /** 响应 URL */
  url: string;
  /** HTTP 状态码 */
  status: number;
  /** 响应头 */
  headers?: Record<string, string>;
  /** 响应体 */
  body?: string;
  /** 时间戳（毫秒） */
  timestamp: number;
}

/**
 * Sniffer 消息（联合类型）
 */
export type SnifferMessage = WsMessageData | HttpRequestData | HttpResponseData;

/**
 * Sniffer 配置选项
 */
export interface SnifferOptions {
  /** WebSocket URL 过滤模式（正则字符串） */
  wsPattern?: string;
  /** HTTP URL 过滤模式（正则字符串） */
  httpPattern?: string;
  /** 超时时间（毫秒），默认 30000 */
  timeout?: number;
  /** 用户代理 */
  userAgent?: string;
  /** 视口大小 */
  viewport?: { width: number; height: number };
  /** 是否等待特定条件 */
  waitCondition?: {
    type: 'selector' | 'timeout' | 'message_count';
    value: string | number;
  };
  /** 额外的 HTTP 头 */
  extraHeaders?: Record<string, string>;
}

/**
 * Sniffer 会话信息
 */
export interface SnifferSession {
  /** 会话 ID */
  id: string;
  /** 目标 URL */
  url: string;
  /** 开始时间 */
  startTime: number;
  /** 状态 */
  status: 'running' | 'stopped' | 'error';
  /** 错误信息 */
  error?: string;
}

/**
 * Sniffer 结果
 */
export interface SnifferResult {
  /** 是否成功 */
  success: boolean;
  /** 会话 ID */
  sessionId: string;
  /** 抓取的消息列表 */
  messages: SnifferMessage[];
  /** 错误信息 */
  error?: string | undefined;
  /** 性能统计 */
  timing?: {
    start: number;
    end: number;
    duration: number;
  } | undefined;
}

/**
 * Sniffer 事件回调
 */
export interface SnifferCallbacks {
  /** 消息回调 */
  onMessage?: (message: SnifferMessage) => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
  /** 完成回调 */
  onComplete?: (result: SnifferResult) => void;
}
