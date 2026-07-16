/**
 * SGF 工具函数
 * @module domain/sgf/SGFUtils
 */

import { SGFParser } from './SGFParser';

/**
 * 构建 archive URL
 * @description 从 SGF 内容构建 archive URL，用于 fetcher 页面加载
 * @param sgf SGF 内容
 * @returns archive URL (格式: archive:<base64>?black=...&white=...&size=...)
 */
export function buildArchiveUrl(sgf: string): string {
  // 1. 解析 SGF 提取元数据
  const parser = new SGFParser();
  const result = parser.parse(sgf);
  const { black, white, boardSize } = result.gameInfo;
  
  // 2. Base64 编码 SGF（URL 安全）
  const encoded = encodeBase64UrlSafe(sgf);
  
  // 3. 构建参数
  const params = new URLSearchParams({
    black: black || '黑方',
    white: white || '白方',
    size: String(boardSize || 19),
  });
  
  // 4. 返回 archive URL
  return `archive:${encoded}?${params.toString()}`;
}

/**
 * Base64 编码（URL 安全）
 * @description 将字符串编码为 URL 安全的 Base64 格式
 * @param str 要编码的字符串
 * @returns URL 安全的 Base64 字符串
 */
function encodeBase64UrlSafe(str: string): string {
  // 先将 Unicode 转为 Latin1 字节序列，再 btoa
  const encoded = btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
      String.fromCharCode(parseInt(p1, 16)),
    )
  );
  
  // URL 安全：+ → -, / → _, 去除 =
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
