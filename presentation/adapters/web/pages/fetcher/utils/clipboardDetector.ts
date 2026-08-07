/**
 * 剪贴板 URL 检测工具
 * @module presentation/pages/fetcher/utils/clipboardDetector
 */
import { WebClipboard } from '../../../../../../infrastructure/utils/clipboard/WebClipboard';
/** 支持的棋谱平台 URL 模式 */
const SHARE_LINK_PATTERNS = [
  /foxwq\.com/i,
  /online-go\.com/i,
  /101weiqi\.com/i,
  /yikeweiqi\.com/i,
  /yuanluobo\.com/i,
  /19x19\.com/i,
  /izis\.cn/i,
  /eweiqi\.com/i,
  /txwq\.qq\.com/i,
  /h5\.txwq\.qq\.com/i,
  /xinboduiyi\.com/i,
  /dzqzd\.com/i,
];
/**
 * 从剪贴板检测棋谱 URL
 * @returns 如果剪贴板包含支持的 URL，返回该 URL；否则返回 null
 */
export async function detectClipboardUrl(): Promise<string | null> {
  const clipboard = new WebClipboard();
  if (!clipboard.isAvailable()) return null;
  const text = await clipboard.readText();
  return extractShareUrl(text);
}
/**
 * 从文本中提取 URL
 */
export function extractUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const match = text.match(/(https?:\/\/[^\s"'<>]+)/i);
  return match?.[1] ?? null;
}
/**
 * 从文本中提取棋谱分享 URL
 */
export function extractShareUrl(text: string | null | undefined): string | null {
  const url = extractUrl(text);
  if (!url) return null;
  return isShareLink(url) ? url : null;
}
/**
 * 检查是否是支持的棋谱分享链接
 */
export function isShareLink(url: string): boolean {
  return SHARE_LINK_PATTERNS.some(p => p.test(url));
}