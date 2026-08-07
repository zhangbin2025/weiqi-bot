/**
 * 平台相关类型定义
 */

/**
 * 平台类型
 */
export type PlatformType =
  | 'web'
  | 'nodejs'
  | 'electron'
  | 'react-native'
  | 'miniprogram-wechat'
  | 'miniprogram-alipay'
  | 'android-native'
  | 'ios-native';

/**
 * 平台能力
 */
export interface PlatformCapabilities {
  /** 是否支持 WebView */
  webview: boolean;
  /** 是否支持 Playwright */
  playwright: boolean;
  /** 是否支持原生文件系统 */
  nativeFS: boolean;
  /** 是否支持原生网络 */
  nativeNetwork: boolean;
  /** 是否支持进程启动 */
  canSpawnProcess: boolean;
}

/**
 * WebSocket 消息数据
 */
export interface WebSocketMessage {
  url: string;
  direction: 'send' | 'receive';
  data: string;
  timestamp: number;
}

/**
 * HTTP 响应数据
 */
export interface HttpResponseData {
  url: string;
  method: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  timestamp: number;
}

/**
 * WebView 配置选项
 */
export interface WebViewOptions {
  /** Hook WebSocket */
  hookWebSocket?: boolean;
  /** Hook HTTP/Fetch */
  hookHttp?: boolean;
  /** 提取页面变量 */
  extractVariables?: string[];
  /** 用户代理 */
  userAgent?: string;
  /** 超时（毫秒） */
  timeout?: number;
  /** 注入额外脚本 */
  injectedScripts?: string[];
}
