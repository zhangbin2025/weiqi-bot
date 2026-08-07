/**
 * 服务器配置常量
 * @description 集中管理所有服务器域名和默认 URL，避免硬编码分散在各模块
 *
 * 各客户端可通过自己的配置覆盖这些默认值：
 * - Android: gradle.properties → BuildConfig.REMOTE_BASE
 * - Desktop: clients/desktop/src/main/config.ts → AppConfig.remoteBase
 * - CLI: clients/cli/bootstrap.ts → DEFAULT_JOSEKI_CONFIG.dataUrl
 * - Web:  桥接 config:get → remoteBase
 */

/** 默认远程资源服务器基础 URL */
export const DEFAULT_REMOTE_BASE = 'https://bot.weiqi.lol';

/**
 * 根据 remoteBase 构造完整 URL
 * @param remoteBase - 远程基础 URL（如 'https://bot.weiqi.lol'）
 * @param path - 资源路径（可有前导 /）
 * @returns 完整 URL
 */
export function buildRemoteUrl(remoteBase: string, path: string): string {
  const normalized = path.startsWith('/') ? path : '/' + path;
  return remoteBase + normalized;
}
