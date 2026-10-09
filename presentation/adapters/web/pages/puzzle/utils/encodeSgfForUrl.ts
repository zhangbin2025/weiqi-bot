/**
 * SGF → 打谱页 URL 参数编码
 * @module presentation/adapters/web/pages/puzzle/utils/encodeSgfForUrl
 * @description 做题页跳转到 replay 页查看本题棋谱时，需把 SGF 原文塞进 URL 的 sgf 参数。
 *              replay 侧用 `decodeURIComponent(escape(atob(sgf)))` 解码，
 *              即期望「UTF-8 字节流的标准 base64」，因此编码侧必须先按 UTF-8 取字节再 base64。
 *              直接 btoa(字符串) 会在 SGF 含中文注释（如题名、解说）时抛
 *              InvalidCharacterError，故这里统一走 TextEncoder。
 */

/**
 * 将 SGF 原文编码为 replay 页 sgf 参数可用的 base64 字符串
 * @param sgf - SGF 原文
 * @returns 标准 base64（UTF-8 字节流），可直接拼入 URL（外层再 encodeURIComponent）
 */
export function encodeSgfForUrl(sgf: string): string {
  const bytes = new TextEncoder().encode(sgf);
  let binary = '';
  // 分块拼接，避免超长 SGF 反复扩容字符串
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
