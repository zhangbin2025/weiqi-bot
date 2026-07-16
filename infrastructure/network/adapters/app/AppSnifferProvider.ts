/**
 * App Sniffer 提供者
 * @description 使用 App 端的 Sniffer 框架进行抓包，通过 sniffer:// 协议通信
 */

import type {
  ISnifferProvider,
  ISnifferSession,
} from '../../interfaces/ISnifferProvider';
import type {
  SnifferMessage,
  SnifferOptions,
  SnifferResult,
  WsMessageData,
  HttpRequestData,
  HttpResponseData,
} from '../../interfaces/SnifferTypes';
import { UnsupportedSnifferSession } from '../common/UnsupportedSnifferProvider';

/**
 * App Sniffer 会话
 */
class AppSnifferSession implements ISnifferSession {
  readonly id: string;
  readonly url: string;
  status: 'running' | 'stopped' | 'error' = 'running';

  private messages: SnifferMessage[] = [];
  private messageCallbacks: Array<(message: SnifferMessage) => void> = [];
  private errorCallbacks: Array<(error: Error) => void> = [];
  private startTime: number;
  private resolveWait: ((result: SnifferResult) => void) | null = null;

  constructor(
    id: string,
    url: string,
    options?: SnifferOptions
  ) {
    this.id = id;
    this.url = url;
    this.startTime = Date.now();

    // 注册全局回调
    this.registerGlobalCallbacks();
  }

  private registerGlobalCallbacks(): void {
    // 注册 window.onSnifferData 回调
    if (typeof window !== 'undefined') {
      (window as any).onSnifferData = (json: string) => {
        try {
          this.handleSnifferMessage(json);
        } catch (e) {
          console.error('[Sniffer] 数据处理错误:', e);
        }
      };

      // 注册 window.onSnifferResult 回调
      (window as any).onSnifferResult = (json: string) => {
        try {
          const result = JSON.parse(json);
          const action = result.action || '';
          const data = result.data || '';

          if (action === 'stopped' || action === 'error') {
            this.status = action === 'stopped' ? 'stopped' : 'error';
            if (this.resolveWait) {
              this.resolveWait(this.buildResult());
              this.resolveWait = null;
            }
          }
        } catch (e) {
          console.error('[Sniffer] 状态解析错误:', e);
        }
      };
    }
  }

  private handleSnifferMessage(json: string): void {
    try {
      const data = JSON.parse(json);
      // 处理数组格式（App端发送的是事件数组）
      const events = Array.isArray(data) ? data : [data];
      
      for (const event of events) {
        // App端字段名映射：t->type, u->url, d->data, ts->timestamp
        const rawType = event.t || event.type || '';
        const url = event.u || event.url || '';
        const msgData = event.d || event.data || '';
        const timestamp = event.ts || event.timestamp || Date.now();

        // App端type值映射
        let type = rawType;
        
        // WebSocket 事件映射
        if (rawType === 'open') type = 'ws_open';
        else if (rawType === 'send') type = 'ws_send';
        else if (rawType === 'receive') type = 'ws_receive';
        else if (rawType === 'close') type = 'ws_close';
        // HTTP 事件映射（保持原样）
        else if (rawType.startsWith('http_')) type = rawType;

        // 转换为统一的 SnifferMessage 格式
        let message: SnifferMessage | null = null;

        if (type === 'ws_open') {
          message = {
            type: 'ws_open',
            wsUrl: url,
            timestamp,
          } as WsMessageData;
        } else if (type === 'ws_receive' || type === 'ws_send') {
          const isBinary = event.isBinary || false;
          message = {
            type,
            wsUrl: url,
            data: msgData,
            isBinary,
            timestamp,
          } as WsMessageData;
        } else if (type === 'ws_close') {
          message = {
            type: 'ws_close',
            wsUrl: url,
            data: msgData,
            timestamp,
          } as WsMessageData;
        } else if (type === 'http_request') {
          // HTTP 请求事件
          message = {
            type: 'http_request',
            url: url,
            method: msgData?.method || 'GET',
            headers: msgData?.headers,
            body: msgData?.body,
            timestamp,
          } as HttpRequestData;
        } else if (type === 'http_response') {
          // HTTP 响应事件
          message = {
            type: 'http_response',
            url: url,
            status: msgData?.status || 0,
            headers: msgData?.headers,
            body: msgData?.body,
            timestamp,
          } as HttpResponseData;
        }

        if (message) {
          this.messages.push(message);
          this.messageCallbacks.forEach(cb => cb(message));
        }
      }
    } catch (e) {
      console.error('[Sniffer] 消息解析错误:', e);
    }
  }

  onMessage(callback: (message: SnifferMessage) => void): void {
    this.messageCallbacks.push(callback);
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallbacks.push(callback);
  }

  async wait(timeout?: number): Promise<SnifferResult> {
    const timeoutMs = timeout || 30000;

    return new Promise((resolve) => {
      // 设置超时
      const timer = setTimeout(() => {
        console.warn('[Sniffer] 超时:', timeoutMs + 'ms', '消息数:', this.messages.length);
        this.status = 'stopped';
        resolve(this.buildResult());
      }, timeoutMs);

      // 保存 resolve 函数，供 onSnifferResult 调用
      this.resolveWait = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
    });
  }

  async stop(): Promise<void> {
    if (this.status === 'stopped') return;

    // 调用 sniffer://stop?id=<id>（使用 prompt 避免页面导航）
    if (typeof window !== 'undefined') {
      const stopUrl = `sniffer://stop?id=${this.id}`;
      prompt(stopUrl);
    }

    this.status = 'stopped';
    
    // 关键：立即结束 wait()，避免等待超时
    if (this.resolveWait) {
      this.resolveWait(this.buildResult());
      this.resolveWait = null;
    }
  }

  getMessages(): SnifferMessage[] {
    return [...this.messages];
  }

  private buildResult(): SnifferResult {
    return {
      success: this.status !== 'error',
      sessionId: this.id,
      messages: this.messages,
      error: this.status === 'error' ? '抓包失败' : undefined,
      timing: {
        start: this.startTime,
        end: Date.now(),
        duration: Date.now() - this.startTime,
      },
    };
  }
}

/**
 * App Sniffer 提供者
 */
export class AppSnifferProvider implements ISnifferProvider {
  readonly name = 'app-sniffer';
  readonly displayName = 'App 抓包';
  private sessionCounter = 0;

  async start(url: string, options?: SnifferOptions): Promise<ISnifferSession> {
    // 防御性检查：确保在 App 环境中才调用 prompt
    if (!this.isAvailable()) {
      // 返回错误会话，避免弹出 prompt
      return new UnsupportedSnifferSession(url);
    }
    
    // 使用时间戳和随机数生成唯一 ID，避免冲突
    const sessionId = `app-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.sessionCounter++;

    // 手动构建查询字符串，避免 URLSearchParams 双重编码
    let queryString = `id=${sessionId}&url=${encodeURIComponent(url)}`;

    if (options?.wsPattern) {
      queryString += `&wsPattern=${encodeURIComponent(options.wsPattern)}`;
    }

    if (options?.httpPattern) {
      queryString += `&httpPattern=${encodeURIComponent(options.httpPattern)}`;
    }

    // 调用 sniffer://start 协议（使用 prompt 避免页面导航）
    const snifferUrl = `sniffer://start?${queryString}`;

    if (typeof window !== 'undefined') {
      prompt(snifferUrl);
    }

    // 创建会话
    const session = new AppSnifferSession(sessionId, url, options);

    return session;
  }

  isAvailable(): boolean {
    // 检查是否在 App 环境中
    // 使用 User Agent 判断（项目统一做法）
    if (typeof navigator !== 'undefined') {
      return navigator.userAgent.includes('WeiqiApp');
    }
    return false;
  }

  getEnvironmentDescription(): string {
    return 'App 环境，使用原生 Sniffer 框架（隐藏 GeckoSession + JS 注入）进行抓包。';
  }
}
