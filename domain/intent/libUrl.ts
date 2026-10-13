/**
 * 内置棋谱库 URL（lib://）工具
 * @module domain/intent/libUrl
 *
 * 内置棋谱库由 BuiltinLibraryProvider 提供（打包在本机 assets/data/games 下），URL 格式：
 *   lib://<category>/<date>/<index>   单盘棋谱（index 为该日期下按 id 排序的序号）
 *   lib://<category>                  仅用于源列表（无实际抓取）
 *
 * 与 http(s) 分享链接地位相同：assistant 识别到它即触发「下载棋谱」跳转到 fetcher 页面抓取。
 */

/** 内置棋谱库 URL 正则 */
export const LIB_URL_REGEX = /lib:\/\/[^\s]+/i;

/** 可抓取的棋谱链接正则（在线 http(s) + 内置库 lib://） */
export const GAME_URL_REGEX = /(?:https?|lib):\/\/[^\s]+/i;

/** lib://<category>[/<date>[/<index>]] 的结构化解析正则 */
const LIB_URL_PARSE_REGEX = /^lib:\/\/([^/\s]+)(?:\/([^/\s]+))?(?:\/(\d+))?\/?$/i;

/** 分类 → 展示名 */
const CATEGORY_LABELS: Record<string, string> = {
  'life-and-death': '内置题库',
  'ai-review': '内置棋谱',
};

/** lib:// URL 解析结果 */
export interface LibUrlParts {
  /** 分类（life-and-death / ai-review） */
  category: string;
  /** 日期标签（YYYY-MM-DD） */
  date?: string;
  /** 条目下标 */
  index?: number;
}

/** 判断文本是否是内置棋谱库 URL */
export function isLibUrl(text: string): boolean {
  return LIB_URL_REGEX.test(text);
}

/** 判断文本是否是可抓取的棋谱链接（http/https/lib） */
export function isGameUrl(text: string): boolean {
  return GAME_URL_REGEX.test(text);
}

/** 从文本中提取内置棋谱库 URL */
export function extractLibUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(LIB_URL_REGEX);
  return match ? match[0] : null;
}

/**
 * 解析 lib:// URL
 * @returns 解析成功返回各部分，失败返回 null
 */
export function parseLibUrl(url: string): LibUrlParts | null {
  const match = url.trim().match(LIB_URL_PARSE_REGEX);
  if (!match) return null;
  const parts: LibUrlParts = { category: match[1]! };
  const date = match[2];
  const indexRaw = match[3];
  if (date !== undefined) parts.date = date;
  if (indexRaw !== undefined) parts.index = parseInt(indexRaw, 10);
  return parts;
}

/**
 * 生成 lib:// URL 的可读描述，用于 UI 显示
 * 例：lib://life-and-death/2026-10-12/0 → 「内置题库 2026-10-12 #1」
 */
export function describeLibUrl(url: string): string {
  const parts = parseLibUrl(url);
  if (!parts) return url;
  const segments: string[] = [CATEGORY_LABELS[parts.category] ?? parts.category];
  if (parts.date !== undefined) segments.push(parts.date);
  if (parts.index !== undefined) segments.push('#' + (parts.index + 1));
  return segments.join(' ');
}
