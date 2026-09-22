/**
 * @fileoverview 隧道管理器（全局单例）
 * @description 任何页面都可通过 TunnelManager 获取隧道客户端
 *
 * 工作方式：
 * - 读取 localStorage 配置
 * - client 模式：懒创建 TunnelClient，首次调用时连接
 * - 提供 waitForConnection() 让 RemoteAdapter 在 init() 时等待连接就绪
 * - 页面切换不影响：TunnelClient 是模块级单例，重新 import 仍为同一实例
 */

import { TunnelClient } from './TunnelClient';
import { LocalStorageAdapter } from '../storage/adapters/web/LocalStorageAdapter';
import type { ITunnelConfig, TunnelConnectionState } from './types';
import { DEFAULT_TUNNEL_CONFIG } from './types';

/** localStorage 键名（与 TunnelPanel 一致） */
const STORAGE_KEY = 'weiqi-tunnel-config';

/** 等待连接超时 */
const CONNECT_TIMEOUT = 30_000;

export class TunnelManager {
  private static instance: TunnelManager | null = null;
  private client: TunnelClient | null = null;
  private connecting: Promise<TunnelClient | null> | null = null;
  private stateCallbacks: Array<(state: TunnelConnectionState) => void> = [];
  /** 配置存储适配器（统一走 infrastructure 封装，命名空间 weiqi-bot） */
  private readonly storage = new LocalStorageAdapter('weiqi-bot');
  /** 配置内存缓存，保持 loadConfig/isClientMode 同步语义不变 */
  private config: ITunnelConfig = { ...DEFAULT_TUNNEL_CONFIG };

  private constructor() {
    // 同步填充配置缓存：createAIEngine 等同步上下文需即时读到正确 mode
    this.config = this.readConfigSync();
  }

  /** 同步从存储读取配置（localStorage 本身同步，绕开 async 包装） */
  private readConfigSync(): ITunnelConfig {
    try {
      const stored = this.storage.readSync<ITunnelConfig>(STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_TUNNEL_CONFIG, ...stored };
      }
    } catch {
      // ignore
    }
    return { ...DEFAULT_TUNNEL_CONFIG };
  }

  static getInstance(): TunnelManager {
    if (!TunnelManager.instance) {
      TunnelManager.instance = new TunnelManager();
    }
    return TunnelManager.instance;
  }

  /** 注册状态变更回调（客户端模式有效） */
  onStateChange(callback: (state: TunnelConnectionState) => void): void {
    this.stateCallbacks.push(callback);
    // 如果已有 client，立即通知当前状态
    const currentState = this.client?.getState();
    if (currentState) {
      callback(currentState);
    }
  }

  /** 主动从存储重新加载配置到内存缓存（备用：配置被外部修改后可调用） */
  async reload(): Promise<void> {
    try {
      await this.storage.initialize();
      const stored = await this.storage.read<ITunnelConfig>(STORAGE_KEY);
      this.config = stored
        ? { ...DEFAULT_TUNNEL_CONFIG, ...stored }
        : { ...DEFAULT_TUNNEL_CONFIG };
    } catch {
      // ignore
    }
  }

  /** 读取配置（同步，返回内存缓存） */
  loadConfig(): ITunnelConfig {
    return this.config;
  }

  /** 保存配置：写入存储并同步更新内存缓存 */
  async saveConfig(config: ITunnelConfig): Promise<void> {
    await this.storage.initialize();
    await this.storage.write(STORAGE_KEY, config);
    this.config = { ...config };
  }

  /** 当前是否为客户端模式 */
  isClientMode(): boolean {
    const config = this.loadConfig();
    return config.mode === 'client' && !!config.password;
  }

  /** 当前是否为服务端模式 */
  isServerMode(): boolean {
    const config = this.loadConfig();
    return config.mode === 'server' && !!config.password;
  }

  /**
   * 获取 TunnelClient（如已连接直接返回，否则开始连接）
   * 返回 null 表示非客户端模式
   */
  async getClient(): Promise<TunnelClient | null> {
    if (!this.isClientMode()) return null;

    // 已连接，直接返回
    if (this.client && this.client.isConnected) {
      return this.client;
    }

    // 正在连接，复用 Promise
    if (this.connecting) {
      return this.connecting;
    }

    // 开始连接
    this.connecting = this.doConnect();
    return this.connecting;
  }

  /** 同步获取 TunnelClient（可能未连接，用于创建 RemoteAdapter） */
  getClientSync(): TunnelClient | null {
    if (!this.isClientMode()) return null;
    if (!this.client) {
      const config = this.loadConfig();
      this.client = new TunnelClient(config);
      // 后台开始连接，不阻塞
      this.connecting = this.doConnect();
    }
    return this.client;
  }

  /** 等待连接就绪 */
  async waitForConnection(): Promise<TunnelClient | null> {
    return this.getClient();
  }

  /** 执行连接 */
  private async doConnect(): Promise<TunnelClient | null> {
    const config = this.loadConfig();
    if (config.mode !== 'client' || !config.password) {
      this.connecting = null;
      return null;
    }

    if (!this.client) {
      this.client = new TunnelClient(config);
    }

    // 如果已连接，直接返回
    if (this.client.isConnected) {
      this.connecting = null;
      return this.client;
    }

    // 连接并等待
    return new Promise<TunnelClient | null>((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[TunnelManager] Connection timeout');
        this.connecting = null;
        // 通知超时状态
        for (const cb of this.stateCallbacks) {
          try { cb('error'); } catch (e) { console.error('[TunnelManager] State callback error:', e); }
        }
        resolve(this.client?.isConnected ? this.client : null);
      }, CONNECT_TIMEOUT);

      this.client!.onStateChange((state) => {
        // 通知所有外部监听器
        for (const cb of this.stateCallbacks) {
          try { cb(state); } catch (e) { console.error('[TunnelManager] State callback error:', e); }
        }
        if (state === 'connected') {
          clearTimeout(timeout);
          this.connecting = null;
          resolve(this.client);
        } else if (state === 'auth-failed' || state === 'error') {
          clearTimeout(timeout);
          this.connecting = null;
          resolve(null);
        }
      });

      this.client!.connect().catch((err) => {
        console.error('[TunnelManager] Connect failed:', err);
        clearTimeout(timeout);
        this.connecting = null;
        resolve(null);
      });
    });
  }

  /** 断开客户端（页面卸载时调用） */
  disconnectClient(): void {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
    this.connecting = null;
  }

  /** 获取当前连接状态 */
  getClientState(): TunnelConnectionState | null {
    return this.client?.getState() ?? null;
  }
}
