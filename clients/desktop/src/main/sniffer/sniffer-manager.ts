/**
 * 抓包管理器
 * 
 * 对等 Android SnifferManager
 * 
 * 实现方案：
 * - 创建隐藏窗口（独立 partition），加载目标页面
 * - 通过 preload 脚本注入 WebSocket 拦截器
 * - 拦截器替换 window.WebSocket，捕获所有 WS 事件
 * - 通过 IPC 将事件发送到主进程
 * - 实时推送到前端（对齐 Android onData 回调）
 * - 事件格式完全对齐 Android（t/u/ts/d）
 * 
 * 注意：Electron 的 CDP debugger 不触发 WebSocket 事件，因此使用 JS 注入方案
 */

import { BrowserWindow, WebContents, session } from 'electron';
import { createLogger } from '../utils/logger';

const log = createLogger('SnifferManager');

/**
 * 事件格式（对齐 Android）
 * 
 * Android WebExtension 发送的事件字段：t(类型), u(URL), ts(时间戳), d(数据), isBinary
 */
export interface SnifferEvent {
  t: string;     // 事件类型：open, send, receive, close, error
  u: string;     // URL
  ts: number;    // 时间戳
  d?: any;       // 数据（payload 字符串）
  isBinary?: boolean;
}

export interface SnifferResult {
  sessionId: string;
  success: boolean;
  events: SnifferEvent[];
  error?: string;
}

export class SnifferManager {
  private sessions: Map<string, SnifferSession> = new Map();

  constructor(private window: BrowserWindow) {}

  handleSnifferUri(uri: string): boolean {
    try {
      const urlStr = uri.substring('sniffer://'.length);
      const url = new URL('http://' + urlStr);
      const host = url.hostname;

      switch (host) {
        case 'start': {
          const id = url.searchParams.get('id');
          const targetUrl = url.searchParams.get('url');
          const timeout = parseInt(url.searchParams.get('timeout') || '30000');

          if (id && targetUrl) {
            this.start(id, targetUrl, timeout);
            return true;
          }
          console.error('[SnifferManager] Missing id or url for start');
          return false;
        }

        case 'stop': {
          const id = url.searchParams.get('id');
          if (id) {
            this.stop(id);
            return true;
          }
          return false;
        }

        case 'flush': {
          const id = url.searchParams.get('id');
          if (id) {
            this.flush(id);
            return true;
          }
          return false;
        }

        case 'status': {
          const id = url.searchParams.get('id');
          if (id) {
            const status = this.getStatus(id);
            this.pushResult('onSnifferStatus', status);
            return true;
          }
          return false;
        }

        default:
          console.warn(`[SnifferManager] Unknown host: ${host}`);
          return false;
      }
    } catch (error: any) {
      console.error('[SnifferManager] Failed to parse URI:', error);
      return false;
    }
  }

  start(id: string, targetUrl: string, timeoutMs: number = 30000): SnifferSession {
    this.stop(id);

    const session = new SnifferSession(
      id,
      targetUrl,
      this.window,
      timeoutMs,
      (result) => {
        this.sessions.delete(id);
        this.pushResult('onSnifferResult', {
          action: 'completed',
          data: result.sessionId,
          events: result.events.length,
          success: result.success,
          error: result.error,
        });
      }
    );

    this.sessions.set(id, session);
    session.start();

    console.log(`[SnifferManager] Started session [${id}] -> ${targetUrl}`);
    return session;
  }

  stop(id: string): SnifferResult | null {
    const session = this.sessions.get(id);
    if (!session) return null;

    const result = session.stop();
    this.sessions.delete(id);

    console.log(`[SnifferManager] Stopped session [${id}], events: ${result.events.length}`);
    return result;
  }

  flush(id: string) {
    const session = this.sessions.get(id);
    if (session) {
      session.flush();
    }
  }

  getStatus(id: string): { id: string; running: boolean; events: number } {
    const session = this.sessions.get(id);
    if (session) {
      return {
        id,
        running: session.isRunning,
        events: session.eventCount,
      };
    }
    return { id, running: false, events: 0 };
  }

  private pushResult(fn: string, data: any) {
    try {
      const json = JSON.stringify(data);
      const escaped = json.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
      const js = `if(window.${fn}) window.${fn}('${escaped}')`;
      this.window.webContents.executeJavaScript(js);
    } catch (error: any) {
      console.error('[SnifferManager] Failed to push result:', error);
    }
  }
}

/**
 * 抓包会话
 * 
 * 对等 Android SnifferSession
 * 
 * 使用 preload + WebSocket 拦截器捕获网络事件
 * 事件格式完全对齐 Android（t/u/ts/d）
 */
class SnifferSession {
  private events: SnifferEvent[] = [];
  private startTime = 0;
  private timeout: NodeJS.Timeout | null = null;
  private hiddenWindow: BrowserWindow | null = null;

  isRunning = false;

  // 全局映射：webContents.id -> SnifferSession
  // preload 通过固定 IPC 通道发送事件，主进程通过 sender.id 路由
  private static sessionMap = new Map<number, SnifferSession>();
  private static ipcRegistered = false;

  constructor(
    private id: string,
    private targetUrl: string,
    private window: BrowserWindow,
    private timeoutMs: number,
    private onResult: (result: SnifferResult) => void
  ) {}

  get eventCount(): number {
    return this.events.length;
  }

  /**
   * 启动抓包会话
   */
  async start() {
    this.startTime = Date.now();
    this.isRunning = true;

    // 设置超时
    this.timeout = setTimeout(() => {
      console.log(`[SnifferSession] [${this.id}] Timeout after ${this.timeoutMs}ms`);
      this.stop(true);
    }, this.timeoutMs);

    try {
      // 创建隐藏窗口（独立于主窗口）
      // partition: 'sniffer' 使用独立 session，避免被主窗口的 webRequest 代理拦截
      this.hiddenWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: false,  // 需要注入脚本到页面上下文
          webSecurity: false,
          preload: require('path').join(__dirname, 'sniffer-preload.js'),
          partition: 'sniffer',  // 独立 session，不走代理
          offscreen: true,           // 离屏渲染，不实际显示、不播放媒体
          plugins: false,            // 禁用插件（Flash 等）
        },
      });

      const webContents = this.hiddenWindow.webContents;
      // ===== 禁用隐藏窗口所有不必要的功能 =====
      webContents.setAudioMuted(true);          // 静音：禁止音频输出

      // 拦截并丢弃媒体请求（视频/音频文件不下载，节省带宽）
      const snifferSess = session.fromPartition('sniffer');
      snifferSess.webRequest.onBeforeRequest((details, callback) => {
        const url = details.url.toLowerCase();
        // 阻止媒体文件下载（音视频文件后缀 + media 资源类型）
        if (
          url.match(/\.(mp3|mp4|wav|ogg|flac|aac|m4a|webm|avi|mov|wmv)([?#].*)?$/) ||
          details.resourceType === 'media'
        ) {
          callback({ cancel: true });
          return;
        }
        callback({});
      });

      webContents.setWindowOpenHandler(() => ({ action: 'deny' }));  // 禁止弹窗
      webContents.on('will-navigate', (event: Electron.Event) => { event.preventDefault(); });  // 禁止导航跳转

      console.log(`[SnifferSession] [${this.id}] Created hidden window, webContents.id=${webContents.id}`);

      // 注册全局 IPC 监听器（只注册一次）
      if (!SnifferSession.ipcRegistered) {
        const { ipcMain } = require('electron');
        ipcMain.on('sniffer-ws-event', (event: any, data: string) => {
          const senderId = event.sender?.id;
          const session = SnifferSession.sessionMap.get(senderId);
          if (session && session.isRunning) {
            try {
              const wsEvent = JSON.parse(data);
              session.addEvent(wsEvent);
            } catch (e: any) {
              console.error(`[SnifferSession] [${session.id}] Failed to parse WS event:`, e);
            }
          }
        });
        SnifferSession.ipcRegistered = true;
      }

      // 映射 webContents.id -> this session
      SnifferSession.sessionMap.set(webContents.id, this);

      // 窗口关闭时停止会话
      this.hiddenWindow.on('closed', () => {
        this.hiddenWindow = null;
        if (this.isRunning) {
          this.stop(false, 'Window closed');
        }
      });

      // 加载目标 URL
      console.log(`[SnifferSession] [${this.id}] Loading: ${this.targetUrl}`);
      await webContents.loadURL(this.targetUrl);
      console.log(`[SnifferSession] [${this.id}] Loaded: ${this.targetUrl}`);
    } catch (error: any) {
      console.error(`[SnifferSession] [${this.id}] Start failed:`, error);
      this.stop(false, error.message);
    }
  }

  /**
   * 添加事件（实时推送到前端）
   */
  private addEvent(event: SnifferEvent) {
    this.events.push(event);

    // 限制事件数量
    if (this.events.length > 10000) {
      this.events = this.events.slice(-5000);
    }

    // 实时推送到前端（对齐 Android onData 回调）
    this.pushData([event]);
  }

  /**
   * 停止抓包会话
   */
  stop(timeout = false, error?: string): SnifferResult {
    if (!this.isRunning) {
      return {
        sessionId: this.id,
        success: false,
        events: [],
        error: 'Not running',
      };
    }

    this.isRunning = false;

    // 清除超时
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }

    // 清除 session 映射
    if (this.hiddenWindow) {
      SnifferSession.sessionMap.delete(this.hiddenWindow.webContents.id);
    }

    // 关闭隐藏窗口
    if (this.hiddenWindow) {
      try {
        this.hiddenWindow.close();
        this.hiddenWindow = null;
      } catch (err) {
        // 忽略关闭错误
      }
    }

    const duration = Date.now() - this.startTime;
    const events = [...this.events];

    console.log(`[SnifferSession] [${this.id}] Stopped: ${events.length} events, ${duration}ms`);

    return {
      sessionId: this.id,
      success: !timeout && !error,
      events,
      error: timeout ? 'timeout' : error,
    };
  }

  /**
   * 刷新事件到前端
   */
  flush() {
    if (!this.isRunning || this.events.length === 0) return;
    this.pushData([...this.events]);
  }

  /**
   * 推送数据到前端（推送到所有窗口，确保前端能收到）
   */
  private pushData(events: SnifferEvent[]) {
    try {
      const json = JSON.stringify(events);
      const escaped = json.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
      const js = `if(window.onSnifferData) window.onSnifferData('${escaped}')`;

      const allWindows = BrowserWindow.getAllWindows();
      for (const win of allWindows) {
        if (win && !win.isDestroyed()) {
          try {
            win.webContents.executeJavaScript(js);
          } catch (error: any) {
            // 忽略推送失败
          }
        }
      }
    } catch (error: any) {
      console.error(`[SnifferSession] [${this.id}] Failed to push data:`, error);
    }
  }
}
