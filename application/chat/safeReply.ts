/**
 * 渲染前文本清洗（XSS 防线）
 * @module application/chat/safeReply
 *
 * 原实现住在已被删除的自造 JSON 动作协议模块里；这条防线本身必须保留：
 * 渲染层用 marked/innerHTML 解析回复文本，这里是唯一的 HTML 转义入口，
 * 闲聊与插件两个角色都要经过它。
 *
 * 与旧行为的差别（有意为之）：旧 ChatUseCase 只在「装配了插件系统」时才转义，
 * 没装配的闲聊回复直接进渲染器；现在无条件转义，堵上那个缺口。
 */

/** 沿用具 PluginSystem.safeReply 的 2000 字符上限（不是新造阈值） */
export const DEFAULT_REPLY_MAX_CHARS = 2000;

/**
 * 转义 HTML 敏感字符、去控制字符、按 maxChars 截断。
 * 渲染层仍应用 textContent / 转义，这里只是第二道防线。
 */
export function safeReply(text: string, maxChars: number = DEFAULT_REPLY_MAX_CHARS): string {
  const limit = Math.max(0, Math.floor(maxChars));
  const cleaned = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}…` : cleaned;
}
