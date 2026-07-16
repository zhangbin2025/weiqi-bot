/**
 * Playwright Sniffer 提供者
 * @description 使用 Playwright 进行抓包，支持 CLI 环境
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
  HttpResponseData,
} from '../../interfaces/SnifferTypes';

/**
 * Playwright Sniffer 会话
 */
class PlaywrightSnifferSession implements ISnifferSession {
  readonly id: string;
  readonly url: string;
  status: 'running' | 'stopped' | 'error' = 'running';

  private messages: SnifferMessage[] = [];
  private messageCallbacks: Array<(message: SnifferMessage) => void> = [];
  private errorCallbacks: Array<(error: Error) => void> = [];
  private browser: any = null;
  private page: any = null;
  private wsPattern: RegExp | null = null;
  private httpPattern: RegExp | null = null;
  private startTime: number;

  constructor(
    id: string,
    url: string,
    browser: any,
    page: any,
    options?: SnifferOptions
  ) {
    this.id = id;
    this.url = url;
    this.browser = browser;
    this.page = page;
    this.startTime = Date.now();

    if (options?.wsPattern) {
      try {
        this.wsPattern = new RegExp(options.wsPattern);
      } catch (e) {
        console.warn('Invalid wsPattern:', options.wsPattern);
      }
    }

    if (options?.httpPattern) {
      try {
        this.httpPattern = new RegExp(options.httpPattern);
      } catch (e) {
        console.warn('Invalid httpPattern:', options.httpPattern);
      }
    }

    this.setupListeners();
  }

  private setupListeners(): void {
    if (!this.page) return;

    // 监听 WebSocket
    this.page.on('websocket', (ws: any) => {
      const wsUrl = ws.url();

      // 过滤 WebSocket URL
      if (this.wsPattern && !this.wsPattern.test(wsUrl)) {
        return;
      }

      // WebSocket 打开
      const openMsg: WsMessageData = {
        type: 'ws_open',
        wsUrl,
        timestamp: Date.now(),
      };
      this.addMessage(openMsg);

      // 监听消息
      ws.on('framereceived', (frame: any) => {
        try {
          const payload = frame.payload;
          let data: string;
          let isBinary = false;

          if (typeof payload === 'string') {
            data = payload;
          } else {
            // 二进制数据 Base64 编码
            data = Buffer.from(payload).toString('base64');
            isBinary = true;
          }

          const msg: WsMessageData = {
            type: 'ws_receive',
            wsUrl,
            data,
            isBinary,
            timestamp: Date.now(),
          };
          this.addMessage(msg);
        } catch (e) {
          console.error('Error parsing WebSocket frame:', e);
        }
      });

      // 监听发送
      ws.on('framesent', (frame: any) => {
        try {
          const payload = frame.payload;
          let data: string;
          let isBinary = false;

          if (typeof payload === 'string') {
            data = payload;
          } else {
            data = Buffer.from(payload).toString('base64');
            isBinary = true;
          }

          const msg: WsMessageData = {
            type: 'ws_send',
            wsUrl,
            data,
            isBinary,
            timestamp: Date.now(),
          };
          this.addMessage(msg);
        } catch (e) {
          console.error('Error parsing WebSocket send:', e);
        }
      });

      // 监听关闭
      ws.on('close', () => {
        const msg: WsMessageData = {
          type: 'ws_close',
          wsUrl,
          timestamp: Date.now(),
        };
        this.addMessage(msg);
      });
    });

    // 监听 HTTP 响应
    this.page.on('response', (response: any) => {
      const respUrl = response.url();

      // 过滤 HTTP URL
      if (this.httpPattern && !this.httpPattern.test(respUrl)) {
        return;
      }

      // 异步获取响应体
      response.text().then((body: string) => {
        const msg: HttpResponseData = {
          type: 'http_response',
          url: respUrl,
          status: response.status(),
          headers: response.headers(),
          body,
          timestamp: Date.now(),
        };
        this.addMessage(msg);
      }).catch((e: Error) => {
        // 忽略无法读取的响应
      });
    });
  }

  private addMessage(message: SnifferMessage): void {
    this.messages.push(message);
    this.messageCallbacks.forEach(cb => cb(message));
  }

  onMessage(callback: (message: SnifferMessage) => void): void {
    this.messageCallbacks.push(callback);
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallbacks.push(callback);
  }

  async wait(timeout?: number): Promise<SnifferResult> {
    const timeoutMs = timeout || 30000;
    const startTime = Date.now();

    while (this.status === 'running') {
      if (Date.now() - startTime > timeoutMs) {
        await this.stop();
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

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

  async stop(): Promise<void> {
    if (this.status === 'stopped') return;

    try {
      if (this.page) {
        await this.page.close();
      }
      if (this.browser) {
        await this.browser.close();
      }
    } catch (e) {
      console.error('Error closing browser:', e);
    }

    this.status = 'stopped';
  }

  getMessages(): SnifferMessage[] {
    return [...this.messages];
  }

  /**
   * 执行 JavaScript（Playwright 支持）
   */
  async evaluateJavaScript(script: string): Promise<unknown> {
    if (!this.page) {
      throw new Error('Page not available');
    }
    try {
      return await this.page.evaluate(script);
    } catch (e) {
      throw new Error(`JavaScript evaluation failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/**
 * Playwright Sniffer 提供者
 */
export class PlaywrightSnifferProvider implements ISnifferProvider {
  readonly name = 'playwright-sniffer';
  readonly displayName = 'Playwright 抓包';
  private sessionCounter = 0;

  async start(url: string, options?: SnifferOptions): Promise<ISnifferSession> {
    try {
      // 动态导入 Playwright
      const { chromium } = await import('playwright');

      // 启动浏览器
      const browser = await chromium.launch({
        headless: true,
      });

      // 创建页面
      const context = await (browser as any).newContext({
        userAgent: options?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        viewport: options?.viewport || { width: 1280, height: 720 },
        extraHTTPHeaders: options?.extraHeaders,
      });

      const page = await context.newPage();

      // 创建会话
      const sessionId = `playwright-${++this.sessionCounter}`;
      const session = new PlaywrightSnifferSession(sessionId, url, browser, page, options);

      // 导航到目标 URL
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: options?.timeout || 30000,
      });

      return session;
    } catch (error) {
      console.error('Failed to start Playwright:', error);
      throw new Error(`Playwright 启动失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  isAvailable(): boolean {
    // 检查 Playwright 是否可用
    try {
      require.resolve('playwright');
      return true;
    } catch {
      return false;
    }
  }

  getEnvironmentDescription(): string {
    return 'CLI 环境，使用 Playwright 浏览器自动化进行抓包。';
  }
}
