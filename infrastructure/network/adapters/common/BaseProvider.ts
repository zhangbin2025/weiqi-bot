/**
 * 基础网络提供者类
 * @description 提供网络提供者的通用基础实现
 * @ai-example
 * class CustomProvider extends BaseProvider {
 *   async request<T>(config: IRequestConfig): Promise<IResponse<T>> {
 *     // 实现具体逻辑
 *   }
 * }
 */

import type {
  INetworkProvider,
  INetworkProviderConfig,
  IRequestConfig,
  IResponse,
  IWebSocket,
  IWebSocketOptions,
  IWebRTC,
  IWebRTCConfig,
  Environment
} from '../../interfaces';

/**
 * 基础网络提供者抽象类
 */
export abstract class BaseProvider implements INetworkProvider {
  readonly name: string;
  readonly priority: number;
  readonly supportedEnvironments: Environment[];

  protected timeout: number;
  protected retry: number;
  protected customConfig: Record<string, unknown>;

  constructor(config: INetworkProviderConfig) {
    this.name = config.name;
    this.priority = config.priority ?? 0;
    this.supportedEnvironments = config.supportedEnvironments ?? [];
    this.timeout = config.timeout ?? 30000;
    this.retry = config.retry ?? 0;
    this.customConfig = config.customConfig ?? {};
  }

  /**
   * 发起 HTTP 请求（抽象方法，子类实现）
   */
  abstract request<T>(config: IRequestConfig): Promise<IResponse<T>>;

  /**
   * 建立 WebSocket 连接（抽象方法，子类实现）
   */
  abstract connect(
    url: string,
    options?: IWebSocketOptions
  ): Promise<IWebSocket>;

  /**
   * 创建 P2P 连接（可选，子类实现）
   */
  async createP2PConnection?(config: IWebRTCConfig): Promise<IWebRTC>;

  /**
   * 检查该提供者是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      return await this.healthCheck();
    } catch {
      return false;
    }
  }

  /**
   * 健康检查（子类可重写）
   */
  async healthCheck(): Promise<boolean> {
    return true;
  }

  /**
   * 初始化提供者（可选）
   */
  async initialize?(): Promise<void>;

  /**
   * 销毁提供者（可选）
   */
  async destroy?(): Promise<void>;

  /**
   * 构建完整 URL
   */
  protected buildUrl(config: IRequestConfig): string {
    let url = config.url;

    // 添加查询参数
    if (config.params && Object.keys(config.params).length > 0) {
      const params = new URLSearchParams();
      Object.entries(config.params).forEach(([key, value]) => {
        params.append(key, String(value));
      });
      url += (url.includes('?') ? '&' : '?') + params.toString();
    }

    return url;
  }

  /**
   * 构建请求体
   * @description 根据 Content-Type 和 data 类型决定如何序列化请求体
   */
  protected buildBody(config: IRequestConfig): BodyInit | null {
    if (config.data === undefined || config.data === null) return null;

    // 字符串直接返回（URLSearchParams.toString() 已经编码好）
    if (typeof config.data === 'string') return config.data;

    // URLSearchParams 实例直接返回
    if (config.data instanceof URLSearchParams) return config.data as BodyInit;

    // FormData 实例直接返回（浏览器环境）
    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      return config.data as BodyInit;
    }

    // ArrayBuffer / Blob 直接返回
    if (config.data instanceof ArrayBuffer ||
        (typeof Blob !== 'undefined' && config.data instanceof Blob)) {
      return config.data as BodyInit;
    }

    // 其他情况 JSON 序列化
    return JSON.stringify(config.data);
  }

  /**
   * 合并请求头
   */
  protected mergeHeaders(
    config: IRequestConfig
  ): Record<string, string> {
    const headers: Record<string, string> = {};

    // URLSearchParams 和 FormData 不设默认 Content-Type（由运行时自动设）
    const isFormLike = config.data instanceof URLSearchParams ||
      (typeof FormData !== 'undefined' && config.data instanceof FormData);

    if (!isFormLike) {
      headers['Content-Type'] = 'application/json';
    }

    return { ...headers, ...config.headers };
  }

  /**
   * 带超时的请求
   */
  protected async requestWithTimeout<T>(
    requestPromise: Promise<T>,
    timeout: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);

      requestPromise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}
