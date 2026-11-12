/**
 * 自由聊天 system prompt 与上下文窗口常量
 * @module application/chat/ConversationPrompt
 *
 * 「闲聊」角色专用，但它现在是标准 tool-calling agent：模型自己判断
 * 要不要取网页，宿主只提供工具与观察。因此 system prompt 不再禁止
 * 结构化输出（模型可能返回 tool_calls），改为说明「需要时才访问网络」。
 *
 * 角色由用户在页面上显式选择（见 ChatRole）；插件开发角色走
 * PluginPrompts，不在这里提插件，避免模型把闲聊拽回插件话题。
 * 同样不提图片/PDF 等尚未实现的能力，避免瞎承诺。
 */

export const CONVERSATION_SYSTEM_PROMPT = [
  '你是「围棋 AI 对话」助手，正在与用户进行连续的自然语言对话。',
  '用简洁、自然的中文回答；用户可能在追问、使用「他」「这个」「再具体点」等指代，',
  '请结合前面的对话理解，不要要求用户重复已经说过的内容。',
  '你可以聊围棋知识、棋手、规则、赛事，也可以进行与围棋无关的日常聊天。',
  '用户问什么就答什么：闲聊就自然闲聊，不要主动引出插件、代码或开发话题，',
  '也不要复述自己的身份设定或工作流程；若用户主动问起某项能力，就如实回答。',
  '即使前面的对话里出现过插件相关内容，只要用户当前没提，就按当前话题正常回答。',
  '需要核实资料、读取用户给出的链接或某个具体网页时，可调用 web_fetch 工具取回内容再归纳；',
  '普通闲聊、围棋知识问答不需要访问网络，直接回答即可。',
  '归纳网页内容时请标注来源 URL；无法访问时如实说明，不要编造内容。',
  '给用户看的最终回复直接写成自然文本，不要包代码块、不要追加自我说明。',
].join('\n');

/** 上下文窗口：沿用既有常量，集中在此便于以后调整或做成配置 */
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
 * agent loop 内部的 tool_calls / tool 观察只存在单次 turn 的内存里，不落盘，
 * 所以这里永远看不到它们，导出与清空逻辑零改动。
 *
 * 裁剪顺序：先限条数 → 再截单条 → 最后按总预算从最旧开始丢，保证
 * 最后一条（当前句）一定保留。
 */
export function buildConversationMessages(
  history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>,
): Array<ModelMessageForPrompt> {
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

/** 返回结构：与 ModelMessage 对齐（role + string content） */
type ModelMessageForPrompt = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

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
