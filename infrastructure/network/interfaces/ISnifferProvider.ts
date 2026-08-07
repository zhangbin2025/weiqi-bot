/**
 * Sniffer 提供者接口
 * @description 统一的抓包接口，支持不同平台的实现
 * 
 * @ai-example
 * const sniffer = snifferProvider.start('https://example.com', {
 *   wsPattern: 'wss://game.example.com',
 *   timeout: 15000
 * });
 * sniffer.onMessage(msg => {
 *   if (msg.type === 'ws_receive') {
 *     console.log('Received:', msg.data);
 *   }
 * });
 */

import type {
  SnifferMessage,
  SnifferOptions,
  SnifferResult,
  SnifferSession,
  SnifferCallbacks
} from './SnifferTypes';

/**
 * Sniffer 会话接口
 */
export interface ISnifferSession {
  /** 会话 ID */
  readonly id: string;
  
  /** 目标 URL */
  readonly url: string;
  
  /** 会话状态 */
  readonly status: 'running' | 'stopped' | 'error';
  
  /**
   * 监听消息
   * @param callback 消息回调
   */
  onMessage(callback: (message: SnifferMessage) => void): void;
  
  /**
   * 监听错误
   * @param callback 错误回调
   */
  onError(callback: (error: Error) => void): void;
  
  /**
   * 等待完成
   * @param timeout 超时时间（毫秒）
   * @returns 抓取结果
   */
  wait(timeout?: number): Promise<SnifferResult>;
  
  /**
   * 停止会话
   */
  stop(): Promise<void>;
  
  /**
   * 获取已抓取的消息
   */
  getMessages(): SnifferMessage[];
  
  /**
   * 执行 JavaScript（可选，某些实现可能不支持）
   * @param script JavaScript 代码
   * @returns 执行结果
   */
  evaluateJavaScript?(script: string): Promise<unknown>;
}

/**
 * Sniffer 提供者接口
 */
export interface ISnifferProvider {
  /** 提供者名称 */
  readonly name: string;
  
  /** 显示名称 */
  readonly displayName: string;
  
  /**
   * 启动抓包会话
   * @param url 目标 URL
   * @param options 配置选项
   * @returns 会话对象
   * 
   * @ai-example
   * const session = await snifferProvider.start('https://example.com', {
   *   wsPattern: 'wss://game.example.com',
   *   timeout: 15000
   * });
   * session.onMessage(msg => console.log(msg));
   * const result = await session.wait();
   */
  start(url: string, options?: SnifferOptions): Promise<ISnifferSession>;
  
  /**
   * 是否可用
   * @returns true 表示可用
   * 
   * @ai-example
   * if (snifferProvider.isAvailable()) {
   *   const session = await snifferProvider.start(url);
   * }
   */
  isAvailable(): boolean;
  
  /**
   * 获取当前环境描述
   * @returns 环境描述字符串
   */
  getEnvironmentDescription(): string;
}
