/**
 * 对话页 Agent 响应协议
 * @module application/plugin/AgentProtocol
 *
 * LLM 输出宽松（可能带围栏、前后废话、多余字段），这里做容错解析 + 严格校验。
 * 多余字段一律忽略，防止模型把伪造的 artifactId/权限塞进动作。
 */

import type { AgentActionKind, AgentResponse } from '@domain/plugin/types';

const KINDS: ReadonlySet<string> = new Set([
  'none', 'plugin.list', 'plugin.create', 'plugin.revise', 'plugin.toggle', 'plugin.delete',
]);

/** 尝试解析一段文本为对象；失败返回 undefined */
function tryParse(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** 从任意 LLM 输出里抠出第一个完整的 JSON 对象（自己实现，不依赖 LLMIntentProvider） */
function extractObject(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim();

  const direct = tryParse(trimmed);
  if (direct) return direct as Record<string, unknown>;

  // ```json ... ``` 围栏
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    const parsed = tryParse(fenced.trim());
    if (parsed) return parsed as Record<string, unknown>;
  }

  // 从第一个 { 起，倒序尝试每个 } 作为结尾（后面可能跟了含 } 的废话），最多 40 次
  const start = trimmed.indexOf('{');
  if (start >= 0) {
    const ends: number[] = [];
    for (let i = trimmed.length - 1; i > start; i--) {
      if (trimmed[i] === '}') ends.push(i);
      if (ends.length >= 40) break;
    }
    for (const end of ends) {
      const parsed = tryParse(trimmed.slice(start, end + 1));
      if (parsed) return parsed as Record<string, unknown>;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

/** 解析并校验模型输出 */
export function parseAgentResponse(raw: string): { ok: true; response: AgentResponse } | { ok: false; reason: string } {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, reason: '模型输出为空' };
  }

  const obj = extractObject(raw);
  if (!obj) return { ok: false, reason: '未找到合法 JSON 对象' };

  if (typeof obj['reply'] !== 'string') {
    return { ok: false, reason: '缺少 reply 字段（必须是字符串）' };
  }
  const reply: string = obj['reply'];

  const rawAction = obj['action'];
  if (!isRecord(rawAction)) {
    return { ok: false, reason: '缺少 action 字段（必须是对象）' };
  }

  const kind = rawAction['kind'];
  if (typeof kind !== 'string' || !KINDS.has(kind)) {
    return { ok: false, reason: `action.kind 非法：${String(kind)}` };
  }
  const typedKind = kind as AgentActionKind;

  // 只保留协议允许的字段，多余字段全部丢弃
  const action: AgentResponse['action'] = { kind: typedKind };
  const artifactId = optionalString(rawAction, 'artifactId');
  const name = optionalString(rawAction, 'name');
  const code = optionalString(rawAction, 'code');
  const feedback = optionalString(rawAction, 'feedback');
  const pointId = optionalString(rawAction, 'pointId');
  const intent = optionalString(rawAction, 'intent');
  if (artifactId !== undefined) action.artifactId = artifactId;
  if (name !== undefined) action.name = name;
  if (code !== undefined) action.code = code;
  if (feedback !== undefined) action.feedback = feedback;
  if (pointId !== undefined) action.pointId = pointId;
  if (intent !== undefined) action.intent = intent;

  if (typedKind === 'plugin.create' || typedKind === 'plugin.revise') {
    if (!code || !code.trim()) {
      return { ok: false, reason: `${typedKind} 必须提供完整 code（字符串），不接受 diff 或片段` };
    }
  }
  if (typedKind === 'plugin.revise' && !artifactId) {
    return { ok: false, reason: 'plugin.revise 必须提供 artifactId' };
  }
  if ((typedKind === 'plugin.toggle' || typedKind === 'plugin.delete') && !artifactId) {
    return { ok: false, reason: `${typedKind} 必须提供 artifactId` };
  }

  return { ok: true, response: { reply, action } };
}

/**
 * 安全渲染用的文本：转义 HTML 敏感字符、去控制字符、按 maxChars 截断。
 * 渲染层仍应用 textContent，这里只是第二道防线。
 */
export function safeAgentReply(text: string, maxChars: number): string {
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
