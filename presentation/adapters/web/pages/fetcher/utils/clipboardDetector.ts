/**
 * 剪贴板 URL 检测工具
 * @module presentation/pages/fetcher/utils/clipboardDetector
 */
import { WebClipboard } from '../../../../../../infrastructure/utils/clipboard/WebClipboard';
import { isLibUrl, isKatagoUrl } from '../../../../../../domain/intent/libUrl';
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
 * 支持在线分享链接（http/https）与内置棋谱库链接（lib:// / katago://）
 */
export function extractUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (/^(?:https?|lib|katago):\/\//i.test(trimmed)) return trimmed;
  const match = text.match(/((?:https?|lib|katago):\/\/[^\s"'<>]+)/i);
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
 * 检查是否是支持的棋谱链接
 * 内置棋谱库（lib:// / katago://）无需外链，直接可抓取
 */
export function isShareLink(url: string): boolean {
  if (isLibUrl(url)) return true;
  if (isKatagoUrl(url)) return true;
  return SHARE_LINK_PATTERNS.some(p => p.test(url));
}