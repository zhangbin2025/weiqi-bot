/**
 * 网络提供者接口
 * @description 定义统一的网络操作接口，不同的实现代表不同的连接方式
 * @ai-example
 * const provider: INetworkProvider = new DirectProvider();
 * const response = await provider.request({ url: '/api/games' });
 * console.log(response.data);
 */

import type { Environment } from './Environment';
import type { IRequestConfig } from './IRequestConfig';
import type { IResponse } from './IResponse';
import type { IWebSocket, IWebSocketOptions } from './IWebSocket';
import type { IWebRTC, IWebRTCConfig } from './IWebRTC';

/**
 * 网络提供者接口
 */
export interface INetworkProvider {
  /** 提供者名称（唯一标识） */
  readonly name: string;

  /** 提供者优先级（数字越大优先级越高） */
  readonly priority: number;

  /** 提供者支持的运行环境 */
  readonly supportedEnvironments: Environment[];

  /**
   * 发起 HTTP 请求
   * @param config - 请求配置
   * @returns 响应数据
   * @ai-example
   * const response = await provider.request<Game[]>({
   *   url: 'https://example.com/api/games',
   *   method: 'GET'
   * });
   */
  request<T>(config: IRequestConfig): Promise<IResponse<T>>;

  /**
   * 建立 WebSocket 连接
   * @param url - WebSocket 地址
   * @param options - WebSocket 配置选项
   * @returns WebSocket 实例
   * @ai-example
   * const ws = await provider.connect('wss://example.com/live');
   */
  connect(url: string, options?: IWebSocketOptions): Promise<IWebSocket>;

  /**
   * 创建 P2P 连接（WebRTC）
   * @param config - P2P 配置
   * @returns WebRTC 实例
   */
  createP2PConnection?(config: IWebRTCConfig): Promise<IWebRTC>;

  /**
   * 检查该提供者是否可用
   * @returns 是否可用
   * @ai-example
   * const available = await provider.isAvailable();
   * console.log('Provider available:', available);
   */
  isAvailable(): Promise<boolean>;

  /**
   * 健康检查
   * @returns 是否健康
   */
  healthCheck(): Promise<boolean>;

  /**
   * 初始化提供者（可选）
   */
  initialize?(): Promise<void>;

  /**
   * 销毁提供者（可选）
   */
  destroy?(): Promise<void>;
}

/**
 * 网络提供者配置
 */
export interface INetworkProviderConfig {
  /** 提供者名称 */
  name: string;

  /** 优先级 */
  priority?: number;

  /** 支持的环境 */
  supportedEnvironments?: Environment[];

  /** 超时时间（毫秒） */
  timeout?: number;

  /** 重试次数 */
  retry?: number;

  /** 自定义配置 */
  customConfig?: Record<string, unknown>;
}
