/**
 * KataGo 桥接处理器
 * 
 * 对等 Android KataGoBridgeHandler
 * 处理 katago:* 前缀的桥接消息
 * 
 * 关键设计（与 Android 对齐）：
 * - 使用全局单例 KataGoProcess，避免多实例冲突
 * - 结果通过 pushToTS 推送到渲染进程（window.onKatagoResult）
 * - downloadModel 立即返回 {ok:true,async:true}，下载完成后异步推送
 */

import { KataGoProcess } from '../katago/katago-process';
import { BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

export class KatagoHandler {
  readonly prefix = 'katago:';

  /** 全局单例 KataGo 进程（对等 Android globalKataGoProcess） */
  private static globalProcess: KataGoProcess | null = null;
  private static currentModelPath: string | null = null;

  constructor(private window: BrowserWindow) {}

  handle(message: string): string {
    const withoutPrefix = message.substring(this.prefix.length);
    const colonIdx = withoutPrefix.indexOf(':');
    const command = colonIdx > 0 ? withoutPrefix.substring(0, colonIdx) : withoutPrefix;
    const payload = colonIdx > 0 ? withoutPrefix.substring(colonIdx + 1) : '';

    switch (command) {
      case 'start':
        return this.handleStart(payload);
      case 'send':
        return this.handleSend(payload);
      case 'status':
        return this.handleStatus();
      case 'shutdown':
        return this.handleShutdown();
      case 'downloadModel':
        return this.handleDownloadModel(payload);
      default:
        return JSON.stringify({ error: `Unknown command: ${command}` });
    }
  }

  // ========== katago:start ==========

  private handleStart(payload: string): string {
    try {
      const json = JSON.parse(payload);
      const modelPath = json.modelPath;
      const configPath = json.configPath;

      // 检查全局进程是否已启动（与 Android 对齐）
      if (KatagoHandler.globalProcess && KatagoHandler.globalProcess.isRunning) {
        if (KatagoHandler.currentModelPath === modelPath) {
          // 模型相同，直接复用
          console.log('[KataGo] Process already running with same model, reusing');
          // 推送 katago:ready 事件
          this.pushToTS({ type: 'katago:ready' });
          return JSON.stringify({ ok: true });
        }
        // 模型不同，返回错误
        console.log('[KataGo] Process running with different model, need to restart');
        return JSON.stringify({
          ok: false,
          error: 'KataGo process is running with a different model. Please wait for current tasks to finish.',
          code: 'MODEL_SWITCH_WITH_RUNNING_PROCESS',
        });
      }

      // 创建新进程
      const proc = new KataGoProcess();

      // 设置回调
      proc.setCallbacks({
        window: this.window,
        onMessage: (json) => {
          this.pushToTS(json);
        },
        onExit: (code) => {
          this.pushToTS({ type: 'katago:exit', exitCode: code });
          // 进程退出时清空全局单例
          KatagoHandler.globalProcess = null;
          KatagoHandler.currentModelPath = null;
        },
        onReady: () => {
          this.pushToTS({ type: 'katago:ready' });
        },
      });

      const ok = proc.start(configPath, modelPath);

      if (ok) {
        KatagoHandler.globalProcess = proc;
        KatagoHandler.currentModelPath = modelPath;
        return JSON.stringify({ ok: true });
      } else {
        return JSON.stringify({ ok: false, error: 'Failed to start process' });
      }
    } catch (error: any) {
      return JSON.stringify({ ok: false, error: error.message });
    }
  }

  // ========== katago:send ==========

  private handleSend(payload: string): string {
    const proc = KatagoHandler.globalProcess;
    if (!proc || !proc.isRunning) {
      return JSON.stringify({ ok: false, error: 'KataGo process not running' });
    }

    try {
      proc.sendRawLine(payload);
      return JSON.stringify({ ok: true });
    } catch (error: any) {
      return JSON.stringify({ ok: false, error: error.message });
    }
  }

  // ========== katago:status ==========

  private handleStatus(): string {
    const running = KatagoHandler.globalProcess?.isRunning === true;
    return JSON.stringify({ running });
  }

  // ========== katago:shutdown ==========

  private handleShutdown(): string {
    const proc = KatagoHandler.globalProcess;
    if (proc) {
      proc.shutdown();
      KatagoHandler.globalProcess = null;
      KatagoHandler.currentModelPath = null;
    }
    return JSON.stringify({ ok: true });
  }

  // ========== katago:downloadModel ==========

  /**
   * 下载模型文件
   * 
   * 立即返回 {ok:true,async:true}，避免阻塞 TypeScript 层的事件循环
   * 下载进度和完成通过 pushToTS 异步推送（与 Android 对齐）
   */
  private handleDownloadModel(payload: string): string {
    try {
      const json = JSON.parse(payload);
      const url = json.url;
      const filename = json.filename;

      // 异步下载，不等待结果
      setImmediate(() => {
        try {
          this.downloadModel(url, filename);
        } catch (error: any) {
          this.pushToTS({ type: 'katago:downloadComplete', ok: false, error: error.message });
        }
      });
    } catch (error: any) {
      return JSON.stringify({ ok: false, error: error.message });
    }

    return JSON.stringify({ ok: true, async: true });
  }

  /**
   * 下载模型文件到 web/models 目录
   * 与 Android 对齐：独立于 KataGo 进程，先下载再启动
   */
  private downloadModel(url: string, filename: string): void {
    const modelsDir = path.join(app.getPath('userData'), 'web', 'models');
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true });
    }

    const targetFile = path.join(modelsDir, filename);

    // 已存在则跳过
    if (fs.existsSync(targetFile)) {
      console.log(`[KataGo] Model already exists: ${targetFile}`);
      // 延迟推送，确保 TypeScript 层已设置回调（与 Android 对齐）
      setTimeout(() => {
        this.pushToTS({ type: 'katago:downloadComplete', ok: true, path: `models/${filename}` });
      }, 100);
      return;
    }

    console.log(`[KataGo] Downloading model: ${url} -> ${filename}`);

    const client = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(targetFile);

    client.get(url, (response) => {
      // 处理重定向（包括 301, 302, 307, 308）
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          try { fs.unlinkSync(targetFile); } catch {}
          const fullUrl = redirectUrl.startsWith('http') ? redirectUrl : new URL(redirectUrl, url).toString();
          console.log(`[KataGo] Redirect ${response.statusCode}: ${url} -> ${fullUrl}`);
          this.downloadModel(fullUrl, filename);
          return;
        }
      }
      
      // 检查状态码
      if (response.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(targetFile); } catch {}
        console.error(`[KataGo] Download failed: HTTP ${response.statusCode}`);
        this.pushToTS({ type: 'katago:downloadComplete', ok: false, error: `HTTP ${response.statusCode}` });
        return;
      }

      const totalSize = parseInt(response.headers['content-length'] || '0');
      let downloaded = 0;
      let lastNotifyTime = Date.now();

      response.on('data', (chunk) => {
        downloaded += chunk.length;

        // 每 500ms 推送一次进度（与 Android 对齐）
        const now = Date.now();
        if (now - lastNotifyTime >= 500) {
          const progress = totalSize > 0 ? downloaded / totalSize : 0;
          this.pushToTS({
            type: 'katago:downloadProgress',
            filename,
            loaded: downloaded,
            total: totalSize,
            progress,
          });
          lastNotifyTime = now;
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log(`[KataGo] Model downloaded: ${targetFile}`);
        this.pushToTS({ type: 'katago:downloadComplete', ok: true, path: `models/${filename}` });
      });
    }).on('error', (error) => {
      try { fs.unlinkSync(targetFile); } catch {}
      console.error('[KataGo] Download failed:', error);
      this.pushToTS({ type: 'katago:downloadComplete', ok: false, error: error.message });
    });
  }

  // ========== TS 层推送（对等 Android pushToTS） ==========

  /**
   * 推送消息到渲染进程
   * 
   * 使用 webContents.send IPC 替代 executeJavaScript：
   * - executeJavaScript 在页面导航/加载时会丢失消息
   * - IPC 事件会在渲染进程准备好后送达，更可靠
   */
  private pushToTS(json: any) {
    try {
      const str = JSON.stringify(json);
      
      // 推送到所有窗口（包括主窗口和后台任务窗口）
      const allWindows = BrowserWindow.getAllWindows();
      console.log(`[KataGo] Pushing to ${allWindows.length} windows:`, json.type);
      
      for (const win of allWindows) {
        if (win && !win.isDestroyed()) {
          try {
            // 使用 IPC 推送，比 executeJavaScript 更可靠
            win.webContents.send('katago:result', str);
          } catch (error: any) {
            console.error('[KataGo] Failed to push to window:', error);
          }
        }
      }
    } catch (error: any) {
      console.error('[KataGo] Failed to push to TS:', error);
    }
  }

  // ========== 静态方法（供外部使用） ==========

  static getGlobalProcess(): KataGoProcess | null {
    return KatagoHandler.globalProcess;
  }

  static getCurrentModelPath(): string | null {
    return KatagoHandler.currentModelPath;
  }
}
