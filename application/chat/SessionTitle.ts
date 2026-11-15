/**
 * 会话标题：用模型把首条用户消息压成短标题
 * @module application/chat/SessionTitle
 *
 * 背景：此前标题 = 第一条 user 消息直接截断 30 字，用户把长问题/粘贴内容
 * 发进来时标题栏会被撑得很长。改为：首轮发出后旁路请模型概括成一个短标题，
 * 写回会话数据（ChatSessionData.title），标题栏与历史列表统一按同一上限显示。
 *
 * 数值口径（项目要求每个常数都能说清来源，不接受把人为选择藏进数字里）：
 * - 14 是产品定的「会话标题要短」展示约定值，**由人定、不是算出来的**：
 *   目标是标题栏单行放得下、和右侧角色/菜单按钮不互挤。它不从任何数据集、
 *   屏幕宽度测量或验证集扫网格推导而来；谁觉得不合适直接改这一个常量即可，
 *   模型 prompt 与宿主截断会一起跟着变（不存在第二个隐藏的字数上限）。
 * - 模型侧把同一个常量写进 prompt 要求，宿主侧按同一个常量硬截断兜底，
 *   两处共用一份，不出现「模型限 X、宿主限 Y」的隐含双阈值。
 * - 字符数按 Unicode 码点计（不是显示宽度），避免把 emoji / 代理对切成半个。
 * - 不额外指定 maxTokens / timeoutMs：沿用已保存的 LLM 配置，不凭空造预算；
 *   模型写得再长也由 clampTitle 兜住。
 *
 * 失败语义：模型不可用、超时、返回空、返回废话一律静默降级 —— 标题永远有
 * 值（首条消息的截断摘要），绝不因为「取标题」拖垮或打断正常对话。
 */

import type { IModelGateway } from '../model/IModelGateway';

/** 会话标题最大字符数（来源见模块注释：标题栏单行 UI 约定） */
export const CHAT_TITLE_MAX_CHARS = 14;

/** 标题任务标识：纯文本 chat completions，不挂任何工具 */
export const CHAT_TITLE_TASK = 'chat.title' as const;

const TITLE_SYSTEM_PROMPT = [
  `你在为一段对话生成会话标题。把用户的话概括成不超过 ${CHAT_TITLE_MAX_CHARS} 个字符的中文短语。`,
  '要求：只输出标题本身，不要引号、书名号、标点、编号、解释或代码块；',
  '不要复述问题里的长度修饰，不要补充用户没提到的信息；',
  '若用户只是问候，直接给一个自然得体的短标题。',
].join('\n');

/** 按 Unicode 码点截断，避免把 emoji / 代理对切成半个 */
export function truncateChars(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

/**
 * 把模型返回的原始文本收拾成一个可用的短标题。
 * 返回 null 表示「不可用」，调用方应保留原 fallback 标题。
 */
export function cleanModelTitle(raw: string, max: number = CHAT_TITLE_MAX_CHARS): string | null {
  let s = raw.trim();
  if (!s) return null;
  // 模型爱加解释/换行：只取第一行有意义的文本
  s = s.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  if (!s) return null;
  // 去掉「标题：」这类前缀
  s = s.replace(/^(会话)?标题\s*[:：]\s*/, '');
  // 去掉整对包裹符号（只去成对，不误伤内容中间的引号）
  const pairs: Array<[string, string]> = [
    ['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’'],
    ['「', '」'], ['『', '』'], ['《', '》'], ['【', '】'], ['[', ']'],
  ];
  for (const [open, close] of pairs) {
    if (s.startsWith(open) && s.endsWith(close) && s.length > open.length + close.length) {
      s = s.slice(open.length, -close.length).trim();
      break;
    }
  }
  // 压空白、去首尾标点
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '').trim();
  if (!s) return null;
  return truncateChars(s, max);
}

/** 兜底标题：把任意文本压平成 ≤max 的短串（展示层统一走这里） */
export function clampTitle(text: string, max: number = CHAT_TITLE_MAX_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '新对话';
  return truncateChars(flat, max);
}

/** 短输入无需劳烦模型：本来就在上限内，省一次请求也避免把「你好」改坏 */
export function needsModelTitle(userText: string, max: number = CHAT_TITLE_MAX_CHARS): boolean {
  return [...userText.replace(/\s+/g, ' ').trim()].length > max;
}

/**
 * 旁路生成标题。任何异常都吞掉并返回 null（静默降级）。
 * 不入历史、不挂工具、不渲染，纯粹一次短文本 chat completions。
 */
export async function generateSessionTitle(
  gateway: IModelGateway,
  userText: string,
): Promise<string | null> {
  if (!gateway.isReady() || !needsModelTitle(userText)) return null;
  try {
    const result = await gateway.execute({
      task: CHAT_TITLE_TASK,
      messages: [
        { role: 'system', content: TITLE_SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
      options: { jsonMode: false },
    });
    return cleanModelTitle(result.text);
  } catch {
    return null;
  }
}
