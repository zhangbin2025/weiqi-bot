/**
 * 内置棋谱库 URL（lib:// / katago://）工具
 * @module domain/intent/libUrl
 *
 * 内置棋谱库由 BuiltinLibraryProvider 提供（打包在本机 assets/data/games 下），URL 格式：
 *   lib://<category>/<id>   单盘棋谱（id 为【内容派生】的稳定 ID，32 位 hex）
 *   lib://<category>        仅用于源列表（无实际抓取）
 *
 * 为什么 URL 用内容派生的 md5 而不是「日期 + 下标」（2026-10-28 改）：
 *   内置库是【增量更新】的，每天生成一次。旧的 <date>/<index> 里两者每次都变，
 *   同一盘棋谱今天和昨天的 URL 不同 —— 分享出去的链接过一天就失效，
 *   做题历史按 URL 去重也会把昨天的题判成新题（已做数突破总数）。
 *   改成内容派生后：只要这盘棋谱还在库里，lib://<category>/<id> 就永久可打开。
 *     · 题库(life-and-death)：初始局面棋形哈希（最小路数 × 8 方向 × 黑白互换的规范值）
 *     · 棋谱(ai-review)     ：SGF 内容 md5
 *
 * KataGo 归档棋谱由 KatagoGameProvider 提供，URL 格式：
 *   katago://date/YYYY-MM-DD[/index]  单盘棋谱（index 为该日期下的序号，默认 0）
 *
 * 两者与 http(s) 分享链接地位相同：assistant 识别到即触发「下载棋谱」跳转到 fetcher 抓取。
 * 它们在浏览器里都打不开（伪协议），UI 上只做描述展示 + 复制，不做外链跳转。
 */

/** 内置棋谱库 URL 正则 */
export const LIB_URL_REGEX = /lib:\/\/[^\s]+/i;

/** KataGo 归档棋谱 URL 正则 */
export const KATAGO_URL_REGEX = /katago:\/\/[^\s]+/i;

/**
 * 可抓取的棋谱链接正则（在线 http(s) + 内置库 lib:// + KataGo 归档 katago://）
 * @description katago:// 与 lib:// 同为本地伪协议，地位相同：
 *              assistant 识别到即跳转 fetcher 抓取，只是浏览器打不开、不能当外链。
 */
export const GAME_URL_REGEX = /(?:https?|lib|katago):\/\/[^\s]+/i;

/** lib://<category>[/<id>] 的结构化解析正则（id 为 32 位 hex） */
const LIB_URL_PARSE_REGEX = /^lib:\/\/([^/\s]+)(?:\/([0-9a-f]{32}))?\/?$/i;

/** 分类 → 展示名 */
const CATEGORY_LABELS: Record<string, string> = {
  'life-and-death': '内置题库',
  'ai-review': '内置棋谱',
};

/** lib:// URL 解析结果 */
export interface LibUrlParts {
  /** 分类（life-and-death / ai-review） */
  category: string;
  /** 稳定 ID（32 位 hex，内容派生）；仅源列表 URL 时缺省 */
  id?: string;
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
  const id = match[2];
  if (id !== undefined) parts.id = id;
  return parts;
}

/** katago://date/YYYY-MM-DD[/index] 的结构化解析正则 */
const KATAGO_URL_PARSE_REGEX = /^katago:\/\/date\/(\d{4}-\d{2}-\d{2})(?:\/(\d+))?\/?$/i;

/** 判断文本是否是 KataGo 归档棋谱 URL */
export function isKatagoUrl(text: string): boolean {
  return KATAGO_URL_REGEX.test(text);
}

/** 从文本中提取 KataGo 归档棋谱 URL */
export function extractKatagoUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(KATAGO_URL_REGEX);
  return match ? match[0] : null;
}

/**
 * 解析 katago:// URL
 * @returns 解析成功返回 { date, index }，失败返回 null
 */
export function parseKatagoUrl(url: string): { date: string; index: number } | null {
  const match = url.trim().match(KATAGO_URL_PARSE_REGEX);
  if (!match) return null;
  return { date: match[1]!, index: match[2] ? parseInt(match[2], 10) : 0 };
}

/**
 * 生成 katago:// URL 的可读描述，用于 UI 显示
 * 例：katago://date/2026-10-17/0 → 「KataGo 2026-10-17 #1」
 */
export function describeKatagoUrl(url: string): string {
  const parts = parseKatagoUrl(url);
  if (!parts) return url;
  return `KataGo ${parts.date} #${parts.index + 1}`;
}

/**
 * 生成 lib:// URL 的可读描述，用于 UI 显示
 * 例：lib://life-and-death/9f2c…a1 → 「内置题库 #9f2c」
 */
export function describeLibUrl(url: string): string {
  const parts = parseLibUrl(url);
  if (!parts) return url;
  const segments: string[] = [CATEGORY_LABELS[parts.category] ?? parts.category];
  // 只展示前 4 位：够区分相邻题目，又不会让列表被长串刷屏
  if (parts.id !== undefined) segments.push('#' + parts.id.slice(0, 4));
  return segments.join(' ');
}
