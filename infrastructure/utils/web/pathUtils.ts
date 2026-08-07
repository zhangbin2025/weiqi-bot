/**
 * @fileoverview Web 路径工具函数
 * @description 提供统一的路径解析工具，支持子目录部署
 */

/**
 * 已知的页面模块目录（对应 clients/web/ 下的子目录）
 */
export const MODULE_DIRS = [
  'play', 'review', 'joseki', 'event', 'player',
  'assistant', 'home', 'fetcher', 'recorder',
  'replay', 'opponent', 'decision'
] as const;

/**
 * 获取 Web 根目录（部署路径）
 * @description 通过识别当前页面所属的模块目录，取其上一级作为根目录
 * 
 * @example
 * - /player/index.html → 模块 player → 根目录 /
 * - /weiqi-pro/player/index.html → 模块 player → 根目录 /weiqi-pro/
 * - /play/hm.html → 模块 play → 根目录 /
 * - /weiqi-pro/play/hm.html → 模块 play → 根目录 /weiqi-pro/
 */
export function getWebRoot(): string {
  // Node.js 环境（测试等）返回默认根目录
  if (typeof window === 'undefined') {
    return '/';
  }
  
  const pathname = window.location.pathname;
  const parts = pathname.split('/').filter(p => p !== '');
  
  // 从后往前找第一个匹配的模块目录
  for (let i = parts.length - 1; i >= 0; i--) {
    if ((MODULE_DIRS as readonly string[]).includes(parts[i]!)) {
      // 找到模块目录，它的上一级就是根目录
      const rootParts = parts.slice(0, i);
      return rootParts.length === 0 ? '/' : '/' + rootParts.join('/') + '/';
    }
  }
  
  // 没找到模块目录（可能是根目录 index.html），返回根
  return '/';
}

/**
 * 将相对路径转换为绝对路径
 * @description 基于 Web 根目录解析
 * 
 * @param url - 待转换的 URL
 * @returns 绝对路径 URL
 * 
 * @example
 * toAbsoluteUrl('models/katago.bin.gz') → '/models/katago.bin.gz'
 * toAbsoluteUrl('/models/katago.bin.gz') → '/models/katago.bin.gz'
 * toAbsoluteUrl('https://example.com/model.bin') → 'https://example.com/model.bin'
 */
export function toAbsoluteUrl(url: string): string {
  // 如果是完整 URL，直接返回
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  // 如果是绝对路径（以 / 开头），直接返回
  if (url.startsWith('/')) {
    return url;
  }
  
  // 相对路径，基于 Web 根目录解析
  const webRoot = getWebRoot();
  return webRoot + url;
}
