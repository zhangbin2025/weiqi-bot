/**
 * KataGo 进程管理
 * 
 * 对等 Android KataGoProcess
 * 
 * 关键设计：
 * - start() 同步返回是否成功创建子进程
 * - 结果通过回调推送（onMessage/onExit/onReady）
 * - 模型下载由 KatagoHandler 处理，不在此类中
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { BrowserWindow } from 'electron';
import { createLogger } from '../utils/logger';

const log = createLogger('KataGo');

export class KataGoProcess {
  private process: ChildProcess | null = null;
  private window: BrowserWindow | null = null;
  private onMessageCallback?: (json: any) => void;
  private onExitCallback?: (code: number) => void;
  private onReadyCallback?: () => void;

  isRunning = false;

  /**
   * 设置回调（用于推送结果到渲染进程）
   */
  setCallbacks(options: {
    window: BrowserWindow;
    onMessage?: (json: any) => void;
    onExit?: (code: number) => void;
    onReady?: () => void;
  }) {
    this.window = options.window;
    this.onMessageCallback = options.onMessage;
    this.onExitCallback = options.onExit;
    this.onReadyCallback = options.onReady;
  }

  /**
   * 获取 KataGo 可执行文件路径
   */
  private getKatagoExecutable(): string {
    // 打包后路径
    const bundledPath = path.join(process.resourcesPath, 'katago', process.platform === 'win32' ? 'katago.exe' : 'katago');
    
    // 开发环境路径
    const devPath = path.join(__dirname, '../../katago', process.platform === 'win32' ? 'katago.exe' : 'katago');
    
    // 用户数据目录（允许用户自己放置可执行文件）
    const userPath = path.join(app.getPath('userData'), 'katago', process.platform === 'win32' ? 'katago.exe' : 'katago');
    
    // 优先级：打包 > 用户目录 > 开发环境
    if (fs.existsSync(bundledPath)) {
      console.log('[KataGo] Using bundled executable:', bundledPath);
      return bundledPath;
    }
    
    if (fs.existsSync(userPath)) {
      console.log('[KataGo] Using user executable:', userPath);
      return userPath;
    }
    
    if (fs.existsSync(devPath)) {
      console.log('[KataGo] Using dev executable:', devPath);
      return devPath;
    }
    
    // 尝试从 PATH 查找
    console.warn('[KataGo] No executable found, trying PATH');
    return 'katago';
  }

  /**
   * 启动 KataGo 进程（同步返回是否成功创建进程）
   */
  start(configPath: string, modelPath: string): boolean {
    if (this.isRunning) {
      console.log('[KataGo] Process already running');
      return true;
    }

    // 解析路径
    const localConfigPath = this.resolvePath(configPath);
    const localModelPath = this.resolvePath(modelPath);

    // 检查文件存在
    if (!fs.existsSync(localConfigPath)) {
      throw new Error(`Config file not found: ${localConfigPath}`);
    }

    // 模型文件检查
    if (!fs.existsSync(localModelPath)) {
      throw new Error(`Model file not found: ${localModelPath}`);
    }
    
    // 注释掉 gzip 校验，避免误删文件
    // if (fs.existsSync(localModelPath) && localModelPath.endsWith('.gz')) {
    //   try {
    //     const fd = fs.openSync(localModelPath, 'r');
    //     const buf = Buffer.alloc(2);
    //     fs.readSync(fd, buf, 0, 2, 0);
    //     fs.closeSync(fd);
    //     if (buf[0] !== 0x1f || buf[1] !== 0x8b) {
    //       console.warn(`[KataGo] Corrupted gzip file (not gzip magic), deleting: ${localModelPath}`);
    //       fs.unlinkSync(localModelPath);
    //     }
    //   } catch (e) {
    //     // 忽略检查错误
    //   }
    // }

    const katagoExe = this.getKatagoExecutable();
    
    console.log(`[KataGo] Starting:`);
    console.log(`  Executable: ${katagoExe}`);
    console.log(`  Config: ${localConfigPath}`);
    console.log(`  Model: ${localModelPath}`);

    try {
      // 启动进程
      this.process = spawn(katagoExe, ['analysis', '-config', localConfigPath, '-model', localModelPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.isRunning = true;

      // 读取 stdout
      let buffer = '';
      this.process.stdout?.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            this.handleLine(line);
          }
        }
      });

      // 读取 stderr（日志）
      this.process.stderr?.on('data', (data) => {
        const text = data.toString();
        console.log('[KataGo stderr]', text.substring(0, 200));

        // 检测 Tuning 进度，发送进度通知让前端重置超时计时器
        if (text.includes('Tuning ') && text.includes('/')) {
          console.log('[KataGo] Tuning progress:', text.substring(0, 100));
          this.pushToTS({
            type: 'katago_progress',
            stage: 'tuning',
            message: text,
          });
        }

        // 检测就绪
        if (text.includes('Started, ready to begin handling requests')) {
          console.log('[KataGo] Ready');
          this.onReadyCallback?.();
        }
      });

      // 进程退出
      this.process.on('exit', (code) => {
        console.log(`[KataGo] Process exited with code ${code}`);
        this.isRunning = false;
        this.process = null;
        this.onExitCallback?.(code || 0);
      });

      // 进程错误
      this.process.on('error', (err) => {
        console.error(`[KataGo] Process error:`, err);
        this.isRunning = false;
        this.process = null;
        this.onExitCallback?.(-1);
      });

      return true;
    } catch (error: any) {
      console.error('[KataGo] Failed to start:', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * 发送原始行到 stdin
   */
  sendRawLine(line: string) {
    if (!this.process || !this.isRunning) {
      throw new Error('Process not running');
    }

    this.process.stdin?.write(line + '\n');
    console.log('[KataGo] Sent:', line.substring(0, 100));
  }

  /**
   * 关闭进程
   */
  shutdown() {
    if (!this.process || !this.isRunning) return;

    console.log('[KataGo] Shutting down...');

    // 关闭 stdin，KataGo 会完成队列后退出
    this.process.stdin?.end();

    // 等待 5 秒后强制终止
    setTimeout(() => {
      if (this.process) {
        this.process.kill();
        this.process = null;
      }
      this.isRunning = false;
    }, 5000);

    console.log('[KataGo] Shutdown initiated');
  }

  /**
   * 处理 stdout 行
   */
  private handleLine(line: string) {
    try {
      const json = JSON.parse(line);
      console.log('[KataGo stdout]', line.substring(0, 200));

      // 不再直接推送，由上层 KatagoHandler 统一推送
      if (this.onMessageCallback) {
        this.onMessageCallback(json);
      }
    } catch (error) {
      // 非 JSON 行，忽略
      console.log('[KataGo stdout non-JSON]', line.substring(0, 100));
    }
  }

  /**
   * 推送消息到渲染进程（推送到所有窗口）
   * 
   * 后台任务在隐藏窗口中执行，tuning 进度需要推送到所有窗口
   * 才能让前端的 onKatagoResult 回调收到消息
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
      for (const win of allWindows) {
        if (win && !win.isDestroyed()) {
          try {
            // 使用 IPC 推送，比 executeJavaScript 更可靠
            win.webContents.send('katago:result', str);
          } catch (error: any) {
            // 忽略推送失败
          }
        }
      }
    } catch (error: any) {
      console.error('[KataGo] Failed to push to TS:', error);
    }
  }

  /**
   * 解析路径（对齐 Android resolveWebPath）
   * 
   * "models/katago-small.bin.gz" → "userData/web/models/katago-small.bin.gz"
   * "/models/katago-small.bin.gz" → "userData/web/models/katago-small.bin.gz"
   * "/data/.../model.bin.gz"      → 原样返回（已经是系统绝对路径）
   * 
   * 关键：/katago/xxx 这类 web 路径不应该被 path.isAbsolute() 误判为系统路径
   */
  private resolvePath(p: string): string {
    // 系统绝对路径：Linux /data/...、/home/...、/tmp/... 等
    // 但 /models/、/katago/、/shared/ 等 web 相对路径需要特殊处理
    if (path.isAbsolute(p)) {
      // 检查是否是 web 相对路径（常见的 web 目录前缀）
      const webPrefixes = ['/models/', '/katago/', '/shared/', '/assets/', '/data/joseki/', '/web/'];
      const isWebPath = webPrefixes.some(prefix => p.startsWith(prefix));
      if (isWebPath) {
        // web 相对路径，去掉前导 / 再拼接
        const relative = p.replace(/^\//, '');
        return path.join(app.getPath('userData'), 'web', relative);
      }
      // 其他绝对路径原样返回
      return p;
    }

    // 相对路径 → userData/web/{path}
    const relative = p.replace(/^\//, '');
    return path.join(app.getPath('userData'), 'web', relative);
  }
}
