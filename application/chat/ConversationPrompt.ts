/**
 * 自由聊天 system prompt 与上下文窗口常量
 * @module application/chat/ConversationPrompt
 *
 * 「闲聊」角色专用，但它现在是标准 tool-calling agent：模型自己判断
 * 要不要取网页 / 读 PDF / 看图片，宿主只提供工具与观察。因此 system prompt
 * 不再禁止结构化输出（模型可能返回 tool_calls），改为说明「需要时才访问网络」。
 *
 * 角色由用户在页面上显式选择（见 ChatRole）；插件开发角色走
 * PluginPrompts，不在这里提插件，避免模型把闲聊拽回插件话题。
 */

import type { ModelPart } from '../model/IModelGateway';
import { attachmentsToModelParts, type ChatAttachment } from './ChatAttachment';

export const CONVERSATION_SYSTEM_PROMPT = [
  '你是「围棋 AI 对话」助手，正在与用户进行连续的自然语言对话。',
  '用简洁、自然的中文回答；用户可能在追问、使用「他」「这个」「再具体点」等指代，',
  '请结合前面的对话理解，不要要求用户重复已经说过的内容。',
  '你可以聊围棋知识、棋手、规则、赛事，也可以进行与围棋无关的日常聊天。',
  '用户问什么就答什么：闲聊就自然闲聊，不要主动引出插件、代码或开发话题，',
  '也不要复述自己的身份设定或工作流程；若用户主动问起某项能力，就如实回答。',
  '即使前面的对话里出现过插件相关内容，只要用户当前没提，就按当前话题正常回答。',
  '需要核实资料、读取用户给出的链接或某个具体网页时，可调用 web_fetch 工具取回内容再归纳；',
  '要读 PDF 时调用 web_read_pdf（默认抽取文字层；扫描件或要看版式时用 mode=native）；',
  '要看图片（棋谱截图、表格、照片里的文字）时调用 web_read_image，图片会作为随附内容送达；',
  '用户直接附加的 PDF / 图片也会随消息送达，无需再调用工具重复读取。',
  '普通闲聊、围棋知识问答不需要访问网络，直接回答即可。',
  '归纳网页 / PDF / 图片内容时请标注来源（URL 或文件名）；无法访问或端点不支持时如实说明，不要编造内容。',
  '此前轮次读过的资源内容会作为附件随历史保留，追问时直接沿用，不要说「看不到之前的文件」。',
  '给用户看的最终回复直接写成自然文本，不要包代码块、不要追加自我说明。',
].join('\n');

/** 上下文窗口：沿用既有常量，集中在此便于以后调整或做成配置 */
export const CONTEXT_LIMITS = {
  /** 最多带多少条历史消息（user + assistant 合计）。附件随所在消息受此约束 */
  maxMessages: 20,
  /** 单条消息文本字符上限。附件 base64 不计入（决策 5A，否则图片必被截成半张） */
  maxCharsPerMessage: 2000,
  /** 发给模型的上下文总字符预算（不含 system、不含附件 base64） */
  maxTotalChars: 8000,
} as const;

/** 聊天摘要 / 会话标题：取第一条 user 消息，截断到这个长度 */
export const SUMMARY_MAX_CHARS = 30;

/** 会话消息形状：附件是独立字段，不进 content */
export interface ConversationHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  attachments?: readonly ChatAttachment[];
}

/**
 * 从「当前会话的全部消息（含刚写入的当前句）」构造发给模型的消息数组。
 *
 * 会话里只有干净的 user / assistant 文本 + 独立 attachments 字段，
 * 因此无需按变体筛选，直接倒序取窗口即可。
 * agent loop 内部的 tool_calls / tool 观察只存在单次 turn 的内存里，不落盘。
 *
 * 裁剪顺序：先限条数 → 再截单条文本 → 最后按总文本预算从最旧开始丢，
 * 保证最后一条（当前句）一定保留。字符预算只累计文本；
 * 附件 base64 转成 ModelPart 后挂在同一条消息上，不参与累加（决策 5A）。
 */
export function buildConversationMessages(
  history: ReadonlyArray<ConversationHistoryMessage>,
): Array<ModelMessageForPrompt> {
  const windowed = history.slice(-CONTEXT_LIMITS.maxMessages).map((m) => ({
    role: m.role,
    content: m.content.slice(0, CONTEXT_LIMITS.maxCharsPerMessage),
    ...(m.attachments && m.attachments.length > 0 ? { attachments: m.attachments } : {}),
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
    ...kept.map((m) => {
      if (!m.attachments || m.attachments.length === 0) {
        return { role: m.role, content: m.content } as ModelMessageForPrompt;
      }
      // 文本 + 附件 part 合成多模态 content（附件文字不按字符上限裁剪）
      const parts: ModelPart[] = [
        { type: 'text', text: m.content },
        ...attachmentsToModelParts(m.attachments as ChatAttachment[]),
      ];
      return { role: m.role, content: parts } as ModelMessageForPrompt;
    }),
  ];
}

/** 返回结构：与 ModelMessage 对齐 */
type ModelMessageForPrompt = {
  role: 'system' | 'user' | 'assistant';
  content: string | ModelPart[];
};

/** 会话摘要 / 标题：第一条 user 消息截断（不碰附件，避免截到 base64） */
export function summarizeSession(
  messages: ReadonlyArray<ConversationHistoryMessage>,
): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return '新对话';
  const flat = first.content.replace(/\s+/g, ' ').trim();
  if (!flat) return '新对话';
  return flat.length > SUMMARY_MAX_CHARS
    ? flat.slice(0, SUMMARY_MAX_CHARS) + '...'
    : flat;
}
