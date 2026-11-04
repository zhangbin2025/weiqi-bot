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
 * - greeting 意图不进执行流水线，由上层触发 handleHelp() 展示功能引导
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
/** 打招呼意图：由本层直接触发 handleHelp()，展示功能引导 */
const GREETING_INTENT = 'greeting';

const VALID_INTENTS = new Set<string>([
  ...Object.keys(INTENT_CONFIG),
  ...SPECIAL_INTENTS,
  CHAT_INTENT,
  GREETING_INTENT,
]);

const RESPONSE_TYPES = new Set(['foreground', 'background', 'periodic']);
const MAX_REPLY_LENGTH = 2000;
const MAX_PARAM_LENGTH = 2000;
const MAX_ALTERNATIVES = 3;

export type LLMOutcome =
  | { kind: 'intent'; result: IntentRecognizeResult }
  | { kind: 'chat'; reply: string }
  | { kind: 'greeting' };

/** 构造 system prompt：意图表直接从现有配置生成，避免手抄导致漂移 */
export function buildSystemPrompt(): string {
  const descriptions = new Map(INTENT_KEYWORDS.map(k => [k.intent, k.description]));
  const lines = Object.entries(INTENT_CONFIG).map(([intent, config]) => {
    const desc = descriptions.get(intent) || config.name;
    const params = config.params.length > 0 ? config.params.join(', ') : '（无）';
    return `- ${intent} | ${config.name} | ${desc} | 允许参数: ${params}`;
  });
  lines.push(`- help | 帮助 | 用户询问能做什么 | 允许参数: （无）`);
  lines.push(`- unknown | 无法判断 | 仅限乱码、无意义字符串或完全无法理解的输入；任何能读懂的提问都不要用 unknown | 允许参数: （无）`);
  lines.push(`- ${CHAT_INTENT} | 闲聊与知识问答 | 不要求打开/执行某个功能页面的自然语言提问与闲谈：包含围棋知识、棋手交战历史与趣闻、规则常识、赛事背景，以及任何与围棋无关的日常聊天（不含单纯打招呼） | 允许参数: （无）`);
  lines.push(`- ${GREETING_INTENT} | 打招呼 | 用户只是单纯问候/打招呼（如 hi、你好、hello、早上好、在吗），没有提出任何具体问题或任务 | 允许参数: （无）`);

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
    `4. 当且仅当 intent 为 ${CHAT_INTENT} 时，reply 填你对用户的自然语言回答（中文，简洁）；其它意图（含 ${GREETING_INTENT}）reply 一律空字符串。`,
    `5. 单纯打招呼（hi / 你好 / hello / 早上好 / 在吗 等，且没有附带任何具体问题或任务）一律用 ${GREETING_INTENT}，不要用 ${CHAT_INTENT}、不要用 unknown。`,
    `6. 除打招呼以外，凡是不要求「打开/执行某个功能页面」的自然语言提问与闲谈，一律用 ${CHAT_INTENT} 并在 reply 里直接回答；包括围棋知识、棋手交战历史、规则常识、赛事背景等；不要用 unknown。`,
    '7. 严禁在 params 里放 HTML、脚本、URL 伪协议；棋手名、赛事名等用原文。',
    `8. ${CHAT_INTENT} 的 reply 必须是单行纯文本：严禁出现未转义的 ASCII 双引号 (")、换行、制表符。`,
    '   引用术语请用中文引号「」或全角引号，不要嵌套英文引号；解释完直接收尾，不要追加第二个 JSON。',
    `9. 区分「问答」与「功能调用」：单纯想知道某个信息（如棋手交战历史、什么是打吃、某届赛事背景）→ ${CHAT_INTENT} 直接回答；`,
    '   明确要使用工具/打开页面（如「查查柯洁的等级分」「分析对手」「复盘这盘棋」「下棋」）→ 对应功能意图，不要判 chat。',
    '',
    '示例:',
    '用户输入: 帮我查查柯洁的等级分',
    '输出: {"intent":"query_player","confidence":0.95,"params":{"player":"柯洁"},"responseType":"foreground","alternatives":[],"reply":""}',
    '用户输入: hi',
    '输出: {"intent":"greeting","confidence":0.99,"params":{},"responseType":"foreground","alternatives":[],"reply":""}',
    '用户输入: 你好呀',
    '输出: {"intent":"greeting","confidence":0.99,"params":{},"responseType":"foreground","alternatives":[],"reply":""}',
    '用户输入: 在吗',
    '输出: {"intent":"greeting","confidence":0.97,"params":{},"responseType":"foreground","alternatives":[],"reply":""}',
    '用户输入: 今天天气真不错，随便聊聊',
    '输出: {"intent":"chat","confidence":0.95,"params":{},"responseType":"foreground","alternatives":[],"reply":"是呀，好天气正适合摆一盘棋，最近在研究什么定式？"}',
    '用户输入: 柯洁和申真谞的交战历史',
    '输出: {"intent":"chat","confidence":0.95,"params":{},"responseType":"foreground","alternatives":[],"reply":"两人是当今棋坛的顶尖对手，多次交手互有胜负；具体比分建议以官方赛事记录为准。"}',
    '用户输入: 每天后台看看申真谞的棋谱',
    '输出: {"intent":"analyze_opponent","confidence":0.9,"params":{"player":"申真谞"},"responseType":"periodic","alternatives":[],"reply":""}',
  ].join('\n');
}

/** 尝试解析，失败返回 undefined（绝不把 V8 错误往外抛） */
function tryParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * 保守修复 LLM 常见的 JSON 瑕疵，只动「字符串值内部」，不猜缺失结构：
 * - 字符串内未转义的 ASCII 双引号 → 全角引号（LLM 解释术语时爱加引号，如
 *   `"reply":""双打吃"是..."` 会把 JSON 从 reply 处打断）
 * - 字符串内裸控制字符（换行/tab 等）→ 转义
 * - 尾随逗号 `,}` / `,]` → 去掉
 *
 * 判断「结构引号 vs 内容引号」：引号后第一个非空白字符若是 , } ] : 或结尾，
 * 视为结构引号；否则视为内容引号并替换。
 */
export function repairLooseJson(input: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (!inString) {
      out += ch;
      if (ch === '"') inString = true;
      continue;
    }
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === '\\') { out += ch; escaped = true; continue; }
    if (ch === '"') {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j]!)) j++;
      const next = input[j];
      if (next === undefined || next === ',' || next === '}' || next === ']' || next === ':') {
        out += ch;
        inString = false;
      } else {
        out += '＂'; // 全角引号，不破坏 JSON 结构
      }
      continue;
    }
    if (ch === '\n') { out += '\\n'; continue; }
    if (ch === '\r') { out += '\\r'; continue; }
    if (ch === '\t') { out += '\\t'; continue; }
    const code = ch.charCodeAt(0);
    if (code < 0x20) { out += '\\u' + code.toString(16).padStart(4, '0'); continue; }
    out += ch;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

/**
 * 从 LLM 文本里抠出 JSON：直接解析 → 代码围栏 → 逐个 } 候选（原样 + 修复）
 * → 截断尾巴修复。所有失败统一抛中文友好错误，并 console.warn 原文便于排查。
 */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();

  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  const tryCandidate = (text: string): unknown | undefined =>
    tryParse(text) ?? tryParse(repairLooseJson(text));

  // 代码围栏
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    const r = tryCandidate(fenced.trim());
    if (r !== undefined) return r;
  }

  // 从第一个 { 开始，倒序尝试每个 } 作为结尾（JSON 后面可能跟了含 } 的废话）
  const start = trimmed.indexOf('{');
  if (start >= 0) {
    const ends: number[] = [];
    for (let i = trimmed.length - 1; i > start; i--) {
      if (trimmed[i] === '}') ends.push(i);
      if (ends.length >= 40) break;
    }
    for (const end of ends) {
      const r = tryCandidate(trimmed.slice(start, end + 1));
      if (r !== undefined) return r;
    }
    // 没有结尾 } （输出被截断），也尝试修复一次
    const r = tryCandidate(trimmed.slice(start));
    if (r !== undefined) return r;
  }

  // 绝不把 V8 的 "Expected ',' or '}' ... at position N" 甩给用户
  console.warn('[LLM] 无法解析返回内容：', trimmed.slice(0, 500));
  throw new Error('LLM 返回的内容不是合法 JSON（已尝试容错解析）');
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

  // 打招呼：不进执行流水线，由上层触发 handleHelp() 展示功能引导
  if (intent === GREETING_INTENT) {
    return { kind: 'greeting' };
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
      if (!VALID_INTENTS.has(altIntent) || altIntent === CHAT_INTENT || altIntent === GREETING_INTENT || altIntent === intent) continue;
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
      ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
      ...(config.disableThinking !== undefined ? { disableThinking: config.disableThinking } : {}),
    });

    const chatResult = await client.chat([
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: text },
    ]);

    // 只发当前句，不带历史（按方案确认）
    let parsed: unknown;
    try {
      parsed = extractJson(chatResult.content);
    } catch (error) {
      // 只有「确实解析不了」且输出被截断，才归因为 max_tokens 太小；
      // 否则保留 extractJson 的中文友好错误
      if (chatResult.truncated) {
        throw new Error(
          'LLM 输出被截断（token 预算不足），请用 /llm maxtokens 8192 调大，' +
          '或 /llm thinking off 关闭思考、/llm model 换非推理模型',
        );
      }
      throw error;
    }
    return normalizeLLMResult(parsed);
  }
}
