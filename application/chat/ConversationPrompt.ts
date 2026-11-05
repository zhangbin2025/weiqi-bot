/**
 * 对话模式 system prompt 与上下文窗口常量
 * @module application/chat/ConversationPrompt
 *
 * 一期只做纯文本多轮对话，不提图片/PDF 等尚未实现的能力，避免模型瞎承诺。
 */

export const CONVERSATION_SYSTEM_PROMPT = [
  '你是「围棋 AI 对话」助手，正在与用户进行连续的自然语言对话。',
  '用简洁、自然的中文回答；用户可能在追问、使用「他」「这个」「再具体点」等指代，',
  '请结合前面的对话理解，不要要求用户重复已经说过的内容。',
  '你可以聊围棋知识、棋手、规则、赛事，也可以进行与围棋无关的日常聊天。',
  '直接给出回答，不要输出 JSON、不要包代码块、不要追加自我说明。',
].join('\n');

/** 上下文窗口：一期写死常量，集中在此便于以后调整或做成配置 */
export const CONTEXT_LIMITS = {
  /** 最多带多少条历史消息（user + assistant 合计） */
  maxMessages: 20,
  /** 单条消息字符上限 */
  maxCharsPerMessage: 2000,
  /** 发给模型的上下文总字符预算（不含 system） */
  maxTotalChars: 8000,
} as const;

/** 聊天摘要 / 会话标题：取第一条 user 消息，截断到这个长度 */
export const SUMMARY_MAX_CHARS = 30;

/**
 * 从「当前会话的全部消息（含刚写入的当前句）」构造发给模型的消息数组。
 *
 * 会话里只有干净的 user / assistant 文本（独立 category 存储，不混功能页的
 * 模板文案、HTML、任务块），因此无需按变体筛选，直接倒序取窗口即可。
 *
 * 裁剪顺序：先限条数 → 再截单条 → 最后按总预算从最旧开始丢，保证
 * 最后一条（当前句）一定保留。
 */
export function buildConversationMessages(
  history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const windowed = history.slice(-CONTEXT_LIMITS.maxMessages).map((m) => ({
    role: m.role,
    content: m.content.slice(0, CONTEXT_LIMITS.maxCharsPerMessage),
  }));

  // 从最新往回累加，超预算就停止（保留连续的最新一段，而不是挖掉中间）
  const kept: typeof windowed = [];
  let total = 0;
  for (let i = windowed.length - 1; i >= 0; i--) {
    const msg = windowed[i]!;
    if (total + msg.content.length > CONTEXT_LIMITS.maxTotalChars && kept.length > 0) break;
    total += msg.content.length;
    kept.push(msg);
  }
  kept.reverse();

  return [
    { role: 'system' as const, content: CONVERSATION_SYSTEM_PROMPT },
    ...kept,
  ];
}

/** 会话摘要 / 标题：第一条 user 消息截断 */
export function summarizeSession(
  messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>,
): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return '新对话';
  const flat = first.content.replace(/\s+/g, ' ').trim();
  if (!flat) return '新对话';
  return flat.length > SUMMARY_MAX_CHARS
    ? flat.slice(0, SUMMARY_MAX_CHARS) + '...'
    : flat;
}
