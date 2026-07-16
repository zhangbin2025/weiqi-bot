/**
 * 认证管理器实现
 * @module infrastructure/auth/AuthManager
 */

import type { IAuthManager } from './IAuthManager';
import type { AuthStatus, IUserInfo, IAuthConfig } from './types';

/**
 * 默认域名配置 URL
 */
const DEFAULT_DOMAIN_CONFIG_URL = 'https://weiqi-dev.github.io/weiqi-assets/js/domain.js';

/**
 * 域名缓存时长（10分钟）
 */
const DOMAIN_CACHE_MAX_AGE = 10 * 60 * 1000;

/**
 * 认证管理器
 * 管理 Token 存储、验证和 API 域名动态获取
 * @ai-example
 * const auth = new AuthManager({ tokenKey: 'my_token' });
 * auth.saveToken('abc123');
 * const valid = await auth.validateToken();
 */
export class AuthManager implements IAuthManager {
  private token: string | null = null;
  private _status: AuthStatus = 'unauthenticated';
  private apiBase: string | null = null;
  private apiBasePromise: Promise<string> | null = null;
  private statusCallbacks: Set<(status: AuthStatus) => void> = new Set();

  private readonly tokenKey: string;
  private readonly domainConfigUrl: string;
  private readonly defaultApiUrl: string | undefined;

  constructor(config?: IAuthConfig) {
    this.tokenKey = config?.tokenKey ?? 'weiqi_token';
    this.domainConfigUrl = config?.domainConfigUrl ?? DEFAULT_DOMAIN_CONFIG_URL;
    this.defaultApiUrl = config?.apiUrl ?? undefined;

    // 从 localStorage 加载 token
    this.loadToken();
  }

  /** 认证状态 */
  get status(): AuthStatus {
    return this._status;
  }

  /** 获取 Token */
  getToken(): string | null {
    return this.token;
  }

  /** 保存 Token */
  saveToken(token: string): void {
    // 检测 Token 是否包含非法字符
    if (this.hasInvalidChars(token)) {
      console.warn('Token contains invalid characters, ignoring');
      return;
    }
    this.token = token;
    try {
      localStorage.setItem(this.tokenKey, token);
    } catch {
      // localStorage 不可用时忽略
    }
    this.setStatus('authenticated');
  }

  /** 清除 Token */
  clearToken(): void {
    this.token = null;
    try {
      localStorage.removeItem(this.tokenKey);
    } catch {
      // localStorage 不可用时忽略
    }
    this.setStatus('unauthenticated');
  }

  /** 是否有 Token */
  hasToken(): boolean {
    return !!this.token;
  }

  /** 验证 Token 有效性 */
  async validateToken(token?: string): Promise<boolean> {
    const tokenToValidate = token ?? this.token;
    if (!tokenToValidate) {
      return false;
    }

    try {
      const apiBase = await this.getApiBase();
      const response = await fetch(`${apiBase}/api/status`, {
        headers: { Authorization: `Bearer ${tokenToValidate}` }
      });

      if (response.ok) {
        if (!token) {
          this.setStatus('authenticated');
        }
        return true;
      }

      if (response.status === 401 || response.status === 403) {
        if (!token) {
          this.clearToken();
          this.setStatus('expired');
        }
        return false;
      }

      return false;
    } catch {
      return false;
    }
  }

  /** 获取用户信息 */
  async getUserInfo(): Promise<IUserInfo | null> {
    if (!this.token) {
      return null;
    }

    try {
      const apiBase = await this.getApiBase();
      const response = await fetch(`${apiBase}/api/user`, {
        headers: { Authorization: `Bearer ${this.token}` }
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return {
        id: data.id ?? data.user_id ?? '',
        name: data.name ?? data.username ?? '',
        email: data.email,
        plan: data.plan ?? 'free',
        expiresAt: data.expires_at ?? data.expiresAt
      };
    } catch {
      return null;
    }
  }

  /** 获取 API 基础 URL（动态获取） */
  async getApiBase(): Promise<string> {
    // 如果有默认 URL，直接使用
    if (this.defaultApiUrl) {
      return this.defaultApiUrl;
    }

    // 检查内存缓存
    if (this.apiBase) {
      return this.apiBase;
    }

    // 如果正在获取，返回现有的 Promise
    if (this.apiBasePromise) {
      return this.apiBasePromise;
    }

    // 开始获取
    this.apiBasePromise = this.fetchApiBase();
    try {
      return await this.apiBasePromise;
    } finally {
      this.apiBasePromise = null;
    }
  }

  /** 状态变更回调 */
  onStatusChange(callback: (status: AuthStatus) => void): void {
    this.statusCallbacks.add(callback);
  }

  // === 私有方法 ===

  private loadToken(): void {
    try {
      const stored = localStorage.getItem(this.tokenKey);
      if (stored && !this.hasInvalidChars(stored)) {
        this.token = stored;
        this._status = 'authenticated';
      }
    } catch {
      // localStorage 不可用时忽略
    }
  }

  private setStatus(status: AuthStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.statusCallbacks.forEach(cb => cb(status));
    }
  }

  private hasInvalidChars(str: string): boolean {
    for (let i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) > 255) {
        return true;
      }
    }
    return false;
  }

  private async fetchApiBase(): Promise<string> {
    // 检查 localStorage 缓存
    try {
      const cached = localStorage.getItem('weiqi_api_domain');
      const cachedTime = parseInt(localStorage.getItem('weiqi_api_domain_time') ?? '0', 10);
      const now = Date.now();

      if (cached && now - cachedTime < DOMAIN_CACHE_MAX_AGE) {
        this.apiBase = cached;
        return cached;
      }

      // 从远程加载
      const domain = await this.loadDomainConfig();
      if (domain) {
        this.apiBase = domain;
        try {
          localStorage.setItem('weiqi_api_domain', domain);
          localStorage.setItem('weiqi_api_domain_time', now.toString());
        } catch {
          // localStorage 不可用时忽略
        }
        return domain;
      }

      // 使用过期缓存降级
      if (cached) {
        this.apiBase = cached;
        return cached;
      }
    } catch {
      // 忽略错误
    }

    throw new Error('无法获取 API 域名，请检查网络连接');
  }

  private async loadDomainConfig(): Promise<string | null> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') {
        resolve(null);
        return;
      }

      const script = document.createElement('script');
      script.src = `${this.domainConfigUrl}?v=${Date.now()}`;
      script.crossOrigin = 'anonymous';

      script.onload = () => {
        // 从全局变量获取 API_BASE
        const apiBase = (window as { API_BASE?: string }).API_BASE;
        if (apiBase) {
          resolve(apiBase);
        } else {
          resolve(null);
        }
        script.remove();
      };

      script.onerror = () => {
        resolve(null);
        script.remove();
      };

      document.head.appendChild(script);
    });
  }
}