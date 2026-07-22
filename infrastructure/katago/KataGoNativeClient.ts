/**
 * @fileoverview KataGo 原生进程桥接客户端
 * @description 通过 prompt("katago:*") 与 Kotlin 层通信，管理原生 KataGo 进程
 */

/** 进程启动选项 */
export interface KataGoStartOptions {
  /** 模型 web 相对路径（如 "models/katago-small.bin.gz"） */
  modelPath: string;
  /** 配置 web 相对路径（如 "katago/analysis.cfg"） */
  configPath: string;
}

/** 进程状态 */
export interface KataGoStatus {
  running: boolean;
  /** 当前加载的模型路径（web 相对路径，如 "models/katago-small.bin.gz"），未运行时为 null */
  modelPath: string | null;
}

/** 发送结果 */
export interface KataGoSendResult {
  ok: boolean;
  error?: string;
}

/**
 * KataGoNativeClient — 与原生 KataGo 进程通信
 *
 * 职责：
 * 1. 通过 prompt("katago:*") 调用 Kotlin 桥接
 * 2. 管理请求/响应的 Promise 匹配
 * 3. 处理 analyzeTurns 多结果收集（一次请求可能返回多行）
 *
 * 生命周期：
 * - start() → 发送查询 → 收集结果 → shutdown()
 */
export class KataGoNativeClient {
  private running = false;
  private nextId = 0;

  /** 等待响应的 Promise：id → { resolve, reject, expectedTurns, collected, onProgress } */
  private pending = new Map<string, {
    resolve: (results: string[]) => void;
    reject: (error: Error) => void;
    expectedTurns: number;    // 预期收到几条结果（analyzeTurns.length 或 1）
    collected: string[];      // 已收集的结果行
    onProgress?: ((current: number, total: number) => void) | undefined;  // 进度回调
  }>();

  /** 就绪 Promise */
  private readyResolve: (() => void) | null = null;
  private readyPromise: Promise<void> | null = null;

  /** 启动超时计时器 */
  private startTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private startTimeoutMs = 120000; // 初始超时 120 秒（tuning 可能很长）
  private startReject: ((error: Error) => void) | null = null;

  /** 初始化进度回调 */
  onInitProgress?: (info: { stage: string; message: string; current?: number; total?: number }) => void;

  /** 下载进度回调 */
  onDownloadProgress?: ((info: { filename: string; loaded: number; total: number; progress: number }) => void) | undefined;

  /** 下载完成回调 */
  onDownloadComplete?: ((info: { ok: boolean; path?: string; error?: string }) => void) | undefined;

  /** 进程退出回调 */
  private exitCallbacks: Array<(exitCode: number) => void> = [];

  // ========== 公开 API ==========

  /**
   * 启动 KataGo 进程
   */
  async start(options: KataGoStartOptions): Promise<void> {
    if (this.running) {
      console.warn('[KataGoNativeClient] Process already running');
      return;
    }

    // 设置就绪 Promise（支持进度反馈重置超时）
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.startReject = reject;
    });

    const result = prompt(`katago:start:${JSON.stringify(options)}`);
    if (!result) throw new Error('KataGo start: no response from bridge');

    const resp: { ok: boolean; error?: string } = JSON.parse(result);
    if (!resp.ok) throw new Error(`KataGo start failed: ${resp.error ?? 'unknown'}`);

    // 启动超时计时器（可在进度消息中重置）
    this.resetStartTimeout();

    // 等待进程就绪
    await this.readyPromise;

    // 清除超时计时器
    this.clearStartTimeout();

    this.running = true;
    console.log('[KataGoNativeClient] Process started and ready');
  }

  /**
   * 发送查询到 KataGo
   *
   * @param query 查询对象（不含 id，会自动注入）
   * @param expectedTurns 预期返回几条结果（analyzeTurns 时 > 1）
   * @param onProgress 进度回调（可选）
   * @returns 收集到的所有结果行 JSON 字符串数组
   */
  async sendQuery(query: object, expectedTurns = 1, onProgress?: (current: number, total: number) => void): Promise<string[]> {
    if (!this.running) throw new Error('KataGo process not running');

    const id = `q${this.nextId++}`;
    const queryWithId = { id, ...query };
    const json = JSON.stringify(queryWithId);

    // 注册 pending
    const promise = new Promise<string[]>((resolve, reject) => {
      this.pending.set(id, {
        resolve,
        reject,
        expectedTurns,
        collected: [],
        onProgress,
      });
    });

    // 发送到 Kotlin 层
    const result = prompt(`katago:send:${json}`);
    if (!result) {
      this.pending.delete(id);
      throw new Error('KataGo send: no response from bridge');
    }

    const resp: KataGoSendResult = JSON.parse(result);
    if (!resp.ok) {
      this.pending.delete(id);
      throw new Error(`KataGo send failed: ${resp.error ?? 'unknown'}`);
    }

    return promise;
  }

  /**
   * 查询进程状态（包括模型信息）
   * 
   * 返回底层真实状态，不依赖 TS 层内存变量（页面刷新后仍可靠）
   */
  async status(): Promise<KataGoStatus> {
    const result = prompt('katago:status');
    if (!result) return { running: false, modelPath: null };
    const resp: KataGoStatus = JSON.parse(result);
    return resp;
  }

  /**
   * 关闭 KataGo 进程
   */
  async shutdown(): Promise<void> {
    prompt('katago:shutdown');
    this.running = false;
    // reject 所有 pending
    for (const [id, entry] of this.pending) {
      entry.reject(new Error('KataGo process shutdown'));
    }
    this.pending.clear();
  }

  /**
   * 注册进程退出回调
   */
  onExit(callback: (exitCode: number) => void): void {
    this.exitCallbacks.push(callback);
  }

  /**
   * 进程是否运行中
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * 标记进程为运行中
   * 
   * 用于快速路径：底层进程已在运行，跳过 start() 但需要同步 running 状态
   * 否则后续 sendQuery() 会因 running=false 而报错
   */
  markRunning(): void {
    this.running = true;
    console.log('[KataGoNativeClient] Marked as running (fast path)');
  }

  /**
   * 是否有正在运行的任务
   */
  hasRunningTasks(): boolean {
    return this.pending.size > 0;
  }

  // ========== 启动超时管理 ==========

  /**
   * 重置启动超时计时器
   * 
   * 每次收到进度消息时调用，延长超时时间
   */
  private resetStartTimeout(): void {
    if (this.startTimeoutId) {
      clearTimeout(this.startTimeoutId);
    }
    this.startTimeoutId = setTimeout(() => {
      if (this.startReject) {
        this.startReject(new Error('KataGo start timeout (30s)'));
        this.clearStartTimeout();
      }
    }, this.startTimeoutMs);
  }

  /**
   * 清除启动超时计时器
   */
  private clearStartTimeout(): void {
    if (this.startTimeoutId) {
      clearTimeout(this.startTimeoutId);
      this.startTimeoutId = null;
    }
    this.startReject = null;
  }

  // ========== Kotlin 层回调入口 ==========

  /**
   * 处理原生层推送的结果
   *
   * Kotlin 通过 window.onKatagoResult(json) 调用此方法
   */
  handleResult(json: string): void {
    try {
      const obj = JSON.parse(json);

      // 进程就绪通知
      if (obj.type === 'katago:ready') {
        this.running = true;
        this.readyResolve?.();
        this.readyResolve = null;
        this.clearStartTimeout();
        console.log('[KataGoNativeClient] Process ready notification received');
        return;
      }

      // 进度消息（tuning 等），重置超时计时器
      if (obj.type === 'katago_progress') {
        this.resetStartTimeout();
        console.log('[KataGoNativeClient] Progress:', obj.message?.substring(0, 100));
        
        // 调用进度回调
        if (this.onInitProgress) {
          this.onInitProgress({
            stage: obj.stage || 'unknown',
            message: obj.message || '',
            current: obj.current,
            total: obj.total,
          });
        }
        return;
      }

      // 心跳消息（Kotlin 层在长时间无输出时发送），重置超时计时器
      if (obj.type === "katago:heartbeat") {
        this.resetStartTimeout();
        console.log("[KataGoNativeClient] Heartbeat received, elapsed:", obj.elapsed, "ms");
        // 不调用 onInitProgress，因为心跳不包含进度信息
        return;
      }

      // 下载进度消息
      if (obj.type === 'katago:downloadProgress') {
        console.log('[KataGoNativeClient] Download progress:', obj.filename, obj.loaded, '/', obj.total);
        
        // 调用下载进度回调
        if (this.onDownloadProgress) {
          this.onDownloadProgress({
            filename: obj.filename,
            loaded: obj.loaded,
            total: obj.total,
            progress: obj.progress,
          });
        }
        return;
      }

      // 下载完成消息
      if (obj.type === 'katago:downloadComplete') {
        console.log('[KataGoNativeClient] Download complete:', obj.ok, obj.path, obj.error);
        
        // 调用下载完成回调
        if (this.onDownloadComplete) {
          this.onDownloadComplete({
            ok: obj.ok,
            path: obj.path,
            error: obj.error,
          });
        }
        return;
      }

      // 进程退出通知
      if (obj.type === 'katago:exit') {
        this.running = false;
        const exitCode = obj.exitCode ?? -1;
        for (const cb of this.exitCallbacks) cb(exitCode);
        // reject 所有 pending
        for (const [id, entry] of this.pending) {
          entry.reject(new Error(`KataGo process exited with code ${exitCode}`));
        }
        this.pending.clear();
        console.log('[KataGoNativeClient] Process exit notification, code:', exitCode);
        return;
      }

      // 分析结果：根据 id 匹配
      const id: string | undefined = obj.id;
      
      if (id && this.pending.has(id)) {
        // 检查是否是警告消息（忽略）
        if (obj.warning && !obj.moveInfos && !obj.rootInfo) {
          console.log('[KataGoNativeClient] Ignoring warning message:', obj.warning);
          return;
        }
        
        // 检查是否是错误消息
        if (obj.error) {
          console.error('[KataGoNativeClient] Error in result:', obj.error);
          const entry = this.pending.get(id)!;
          this.pending.delete(id);
          entry.reject(new Error(obj.error));
          return;
        }
        
        const entry = this.pending.get(id)!;
        entry.collected.push(json);
        
        // 调用进度回调
        if (entry.onProgress) {
          entry.onProgress(entry.collected.length, entry.expectedTurns);
        }

        // 收集齐了
        if (entry.collected.length >= entry.expectedTurns) {
          this.pending.delete(id);
          console.log('[KataGoNativeClient] Resolved query id:', id, 'with', entry.collected.length, 'results');
          entry.resolve(entry.collected);
        }
      }
    } catch (e) {
      console.error('[KataGoNativeClient] Failed to handle result', e);
    }
  }
}

// ========== 全局单例 ==========

let singleton: KataGoNativeClient | null = null;

/**
 * 获取 KataGoNativeClient 单例
 */
export function getKataGoNativeClient(): KataGoNativeClient {
  if (!singleton) {
    singleton = new KataGoNativeClient();
    // 注册全局回调
    (window as any).onKatagoResult = (json: string) => {
      singleton!.handleResult(json);
    };
  }
  return singleton;
}

/**
 * 判断是否在 App 环境中（有原生桥接）
 *
 * App 端 GeckoView 的 userAgent 被 override 为 "WeiqiApp/1.0"
 */
export function isNativeKatagoAvailable(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('WeiqiApp');
}
