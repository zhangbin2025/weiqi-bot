/**
 * LLM 意图识别提供者
 * @module application/assistant/LLMIntentProvider
 *
 * 把「当前句」发给 OpenAI 兼容端点，要求返回严格 JSON，
 * 校验/归一化成现有 `IntentRecognizeResult`，下游 ④~⑧ 一行不用改。
 *
 * 安全：LLM 输出一律视为不可信。
 * - intent 必须在白名单内（INTENT_CONFIG 的 key + 特殊意图）
 * - params 按意图的参数白名单过滤，值只允许基本类型，字符串做 HTML 净化
 * - chat 回复做 HTML 转义 + markdown 链接语法中和后再交给 marked 渲染
 */

import type { IntentRecognizeResult } from './IAssistantUseCase';
import { INTENT_CONFIG } from '../../domain/intent/intent-config';
import { INTENT_KEYWORDS } from '../../domain/intent/IntentConfig';
import { OpenAICompatibleClient } from '../../infrastructure/llm/OpenAICompatibleClient';
import {
  loadLLMConfig,
  loadApiKey,
  DEFAULT_LLM_MODEL,
  type LLMStoredConfig,
} from '../../infrastructure/llm/LLMCredentialStore';

/** 特殊意图：不在 INTENT_CONFIG 里，但下游已支持 */
const SPECIAL_INTENTS = ['help', 'unknown'] as const;
/** 闲聊意图：由本层直接回复，不进入跳转/执行流水线 */
const CHAT_INTENT = 'chat';

const VALID_INTENTS = new Set<string>([
  ...Object.keys(INTENT_CONFIG),
  ...SPECIAL_INTENTS,
  CHAT_INTENT,
]);

const RESPONSE_TYPES = new Set(['foreground', 'background', 'periodic']);
const MAX_REPLY_LENGTH = 2000;
const MAX_PARAM_LENGTH = 2000;
const MAX_ALTERNATIVES = 3;

export type LLMOutcome =
  | { kind: 'intent'; result: IntentRecognizeResult }
  | { kind: 'chat'; reply: string };

/** 构造 system prompt：意图表直接从现有配置生成，避免手抄导致漂移 */
export function buildSystemPrompt(): string {
  const descriptions = new Map(INTENT_KEYWORDS.map(k => [k.intent, k.description]));
  const lines = Object.entries(INTENT_CONFIG).map(([intent, config]) => {
    const desc = descriptions.get(intent) || config.name;
    const params = config.params.length > 0 ? config.params.join(', ') : '（无）';
    return `- ${intent} | ${config.name} | ${desc} | 允许参数: ${params}`;
  });
  lines.push(`- help | 帮助 | 用户询问能做什么 | 允许参数: （无）`);
  lines.push(`- unknown | 无法判断 | 无法归入以上任何功能 | 允许参数: （无）`);
  lines.push(`- ${CHAT_INTENT} | 闲聊 | 与围棋无关的问候、聊天、开放问答 | 允许参数: （无）`);

  return [
    '你是「围棋 AI 助手」的意图解析器。把用户这句话解析成一个 JSON 对象，不要输出任何其它文字、不要包 markdown 代码块。',
    '',
    '可用意图（intent | 名称 | 说明 | 允许参数）:',
    ...lines,
    '',
    '输出 JSON 结构:',
    '{"intent":"<上述意图之一>","confidence":0.0~1.0,"params":{},"responseType":"foreground|background|periodic","alternatives":[],"reply":""}',
    '',
    '规则:',
    '1. params 只能出现该 intent「允许参数」列出的键，值只能是字符串/数字/布尔值；没提取到就留空对象，不要编造参数。',
    '2. responseType 默认 foreground。只有用户明确说「后台/后台执行」才用 background；明确说「每天/每周/定时/定期」才用 periodic。',
    '3. alternatives 最多 3 项，每项 {"intent":...,"confidence":...}，用于表达「还可能是哪个意图」。不确定时可为空数组。',
    `4. 当且仅当 intent 为 ${CHAT_INTENT} 时，reply 填你对用户的自然语言回答（中文，简洁）；其它意图 reply 一律空字符串。`,
    '5. 与围棋功能无关的闲聊、问候、常识问答，请用 chat 并在 reply 里直接回答，不要用 unknown。',
    '6. 严禁在 params 里放 HTML、脚本、URL 伪协议；棋手名、赛事名等用原文。',
    '',
    '示例:',
    '用户输入: 帮我查查柯洁的等级分',
    '输出: {"intent":"query_player","confidence":0.95,"params":{"player":"柯洁"},"responseType":"foreground","alternatives":[],"reply":""}',
    '用户输入: 你好呀',
    '输出: {"intent":"chat","confidence":0.99,"params":{},"responseType":"foreground","alternatives":[],"reply":"你好！我是围棋 AI 助手，可以帮你查棋手、复盘、做题、下载棋谱。"}',
    '用户输入: 每天后台看看申真谞的棋谱',
    '输出: {"intent":"analyze_opponent","confidence":0.9,"params":{"player":"申真谞"},"responseType":"periodic","alternatives":[],"reply":""}',
  ].join('\n');
}

/** 从 LLM 文本里抠出 JSON（容忍 ```json 包裹 / 前后废话） */
function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // 去掉代码围栏
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try { return JSON.parse(fenced[1].trim()) as unknown; } catch { /* fall through */ }
    }
    // 取第一个 { 到最后一个 }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    }
    throw new Error('LLM 未返回合法 JSON');
  }
}

/** 字符串净化：去控制字符、转义 HTML、中和 markdown 链接/图片语法 */
export function sanitizeLlmText(raw: string, maxLength: number): string {
  const cleaned = raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .slice(0, maxLength);
  let safe = cleaned
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  // marked 会把 [text](url) 变成 <a>，伪协议有风险 → 只打断 `](` 连接符，
  // 保留普通方括号，避免把正常文本/棋手名改坏
  safe = safe.replace(/\]\s*\(/g, '］(');
  return safe;
}

function clampConfidence(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 归一化 + 白名单校验，把 LLM 输出变成下游可直接用的结构 */
export function normalizeLLMResult(raw: unknown): LLMOutcome {
  if (!isPlainObject(raw)) throw new Error('LLM 返回的不是 JSON 对象');

  const intent = typeof raw['intent'] === 'string' ? raw['intent'].trim() : '';
  if (!VALID_INTENTS.has(intent)) {
    throw new Error(`LLM 返回了未知意图: ${intent || '(空)'}`);
  }

  const confidence = clampConfidence(raw['confidence'], 0.5);

  if (intent === CHAT_INTENT) {
    const replyRaw = typeof raw['reply'] === 'string' ? raw['reply'] : '';
    const reply = sanitizeLlmText(replyRaw, MAX_REPLY_LENGTH).trim();
    if (!reply) throw new Error('LLM 闲聊回复为空');
    return { kind: 'chat', reply };
  }

  // params：只允许该意图配置里声明的键
  const allowedParams = new Set<string>(INTENT_CONFIG[intent]?.params ?? []);
  const params: Record<string, any> = {};
  if (isPlainObject(raw['params'])) {
    for (const [key, value] of Object.entries(raw['params'])) {
      if (!allowedParams.has(key)) continue; // 白名单外的直接丢弃
      if (typeof value === 'string') {
        params[key] = sanitizeLlmText(value, MAX_PARAM_LENGTH);
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        params[key] = value;
      } else if (typeof value === 'boolean') {
        params[key] = value;
      }
      // 对象/数组/null 一律丢弃
    }
  }

  const responseTypeRaw = raw['responseType'];
  const responseType = typeof responseTypeRaw === 'string' && RESPONSE_TYPES.has(responseTypeRaw)
    ? responseTypeRaw as 'foreground' | 'background' | 'periodic'
    : 'foreground';

  const alternatives: Array<{ intent: string; confidence: number }> = [];
  if (Array.isArray(raw['alternatives'])) {
    for (const item of raw['alternatives'].slice(0, MAX_ALTERNATIVES)) {
      if (!isPlainObject(item)) continue;
      const altIntent = typeof item['intent'] === 'string' ? item['intent'] : '';
      if (!VALID_INTENTS.has(altIntent) || altIntent === CHAT_INTENT || altIntent === intent) continue;
      alternatives.push({
        intent: altIntent,
        confidence: clampConfidence(item['confidence'], 0.1),
      });
    }
  }

  const result: IntentRecognizeResult = {
    intent,
    confidence,
    params,
    ...(alternatives.length > 0 ? { alternatives } : {}),
    responseType,
    // LLM 不参与关键词精确匹配，保持 false（倒计时走 5s 分支）
    matchedKeywords: [],
  };
  return { kind: 'intent', result };
}

export class LLMIntentProvider {
  /** 是否已配置过 LLM（有凭据即视为启用，解密失败会在 recognize 里报错） */
  isEnabled(): boolean {
    return loadLLMConfig() !== null;
  }

  /** 解析当前句。任何失败都抛错，由调用方提示并中止，不回落本地识别。 */
  async recognize(text: string): Promise<LLMOutcome> {
    const config: LLMStoredConfig | null = loadLLMConfig();
    if (!config) throw new Error('尚未配置 LLM');
    const apiKey = loadApiKey();
    if (!apiKey) {
      throw new Error('凭据已损坏，请重新 /llm <url> <apikey> <model>');
    }
    const model = config.model || DEFAULT_LLM_MODEL;
    if (!model) {
      throw new Error('未指定模型，请执行 /llm model <模型名>');
    }

    const client = new OpenAICompatibleClient({
      baseUrl: config.baseUrl,
      apiKey,
      model,
      // exactOptionalPropertyTypes: 只在有值时传，不传 undefined
      ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
    });

    const rawText = await client.chat([
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: text },
    ]);

    // 只发当前句，不带历史（按方案确认）
    return normalizeLLMResult(extractJson(rawText));
  }
}
