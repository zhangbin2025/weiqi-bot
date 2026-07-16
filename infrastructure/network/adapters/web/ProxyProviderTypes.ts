/**
 * 浏览器代理提供者类型定义
 */

/**
 * 代理提供者配置
 */
export interface IProxyProviderConfig {
  /** 代理服务器 URL */
  proxyUrl: string;

  /** 是否启用代理（默认 true） */
  enabled?: boolean;
}