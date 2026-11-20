/**
 * 宿主通用展示原语：把 web_fetch(storeOnly) 留在缓存里的结构化 JSON，
 * 按「技能配方声明的字段」渲染成列表 / 表格，直接展示给用户。
 * @module application/skill/primitives/DisplayJsonListPrimitive
 *
 * 数据旁路（本原语存在的唯一理由）：
 *   web_fetch(storeOnly=true) ── 完整正文只写 WebFetchCache，观察只回句柄 ──┐
 *                                                                          ├─ 模型只传「显示声明」，不接收任何数据正文
 *   display_json_list(url, path, fields, format, note) ── 宿主读缓存 → 生成 markdown → displayMarkdown ──┘
 *
 * 通用性边界（本文件不认识任何业务）：
 * - 不写死接口、不写死字段名、不写死列数 / 行数 / 说明文案。数据数组的位置由 path
 *   声明（点分隔），显示哪些字段由 fields 声明，形态由 format 声明，末尾说明由
 *   note 声明 —— 全部来自技能配方 prompt 里的调用模板，宿主只按声明执行。
 * - 模型传的 path / fields / note 是「结构声明 + 静态文案」，不是接口数据本身，
 *   因此不违反「正文不进模型上下文」，也没有大体积 JSON 的延迟 / token 开销。
 * - 以后新增同类 skill（GET 一个 JSON API 再列出来）只改 registry.json 的声明，
 *   不需要再改宿主代码。这正是本原语替代专用 news_table 的原因。
 *
 * 链路：PrimitiveResult.displayMarkdown → ToolOutcome → ToolLoopResult →
 * ChatUseCase.renderMessage 第 11 参 → AssistantRenderer 单独渲染 → ChatMessage
 * 独立字段（renderSession 回放）。ToolLoop 只把 observation 追加成 role:'tool'，
 * displayMarkdown 从构造到落地没有任何一步经过模型消息或 ChatMessage.content。
 *
 * 数值口径：行数 = path 指向的数组实际长度；字段数 / 文本长度 / note 长度都不设
 * 截断阈值，避免引入无来源常数。一次取多少条由配方写在 URL 里的 pagesize 决定
 * （业务明说的默认量），数据量控制归配方，不归宿主。
 * format 缺省为 'list'，来源是 2026-11-20 用户明确要求「默认用列表显示」。
 *
 * 安全边界（宿主强制；字段名现在来自模型，必须防原型污染）：
 * - 属性访问只认自身属性，且拒绝 __proto__ / prototype / constructor。
 * - 每个外部值先清控制字符、escapeHtml，再把 markdown 语法字符转实体、换行压空格。
 * - 链接只接受 http(s) 绝对 URL 且不含空白 / 引号 / 括号 / 控制字符 / userinfo；
 *   保守起见也不收 & 与 #（带 query/fragment 的链接退化为纯文本，文本仍完整显示）。
 */

import type { ModelToolDefinition } from '@application/model/IModelGateway';
import type { SkillPrimitive, PrimitiveResult } from '@application/skill/SkillTypes';
import { defaultWebFetchCache, type WebFetchCache } from '@application/chat/WebFetchCache';

export const DISPLAY_JSON_LIST_TOOL_NAME = 'display_json_list';

export const DISPLAY_JSON_LIST_TOOL: ModelToolDefinition = {
  name: DISPLAY_JSON_LIST_TOOL_NAME,
  description:
    '读取 web_fetch(storeOnly=true) 留在宿主缓存里的结构化 JSON，' +
    '按你声明的 path / fields / format 由宿主直接生成列表或表格展示给用户（数据不进入模型上下文）。' +
    'path 是数据数组在 JSON 里的点分隔路径，fields 声明要显示哪些字段及顺序，都由技能配方给出；' +
    'format 省略时默认 list。工具返回后只写一句简短引导语并停笔：不要复述、归纳或读取数据，' +
    '也不要调用 web_cache_read 把正文读回上下文。',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'web_fetch(storeOnly=true) 观察里给出的绝对 URL，宿主按它从缓存读全文',
      },
      path: {
        type: 'string',
        description: '数据数组在 JSON 对象里的点分隔路径，具体值由技能配方声明',
      },
      format: {
        type: 'string',
        enum: ['list', 'table'],
        description: '展示形态；省略时默认 list',
      },
      fields: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: '从每条记录取值的属性名',
            },
            label: {
              type: 'string',
              description: '可选：表头 / 多字段列表里的前缀显示名',
            },
            hrefKey: {
              type: 'string',
              description: '可选：把本字段包成链接，链接地址取自同一条记录的这个属性',
            },
            subKey: {
              type: 'string',
              description: '可选：本字段值是对象或数组时，对每项取这个属性再连接',
            },
          },
          required: ['key'],
          additionalProperties: false,
        },
        description: '要显示的字段与顺序，具体字段由技能配方声明',
      },
      note: {
        type: 'string',
        description: '可选：末尾一行说明文字（静态文案，由技能配方声明）',
      },
    },
    required: ['url', 'path', 'fields'],
    additionalProperties: false,
  },
};

/** 字段名由模型声明，访问时只认自身属性，并挡住原型链上的危险键 */
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function own(obj: unknown, key: string): unknown {
  if (!key || DANGEROUS_KEYS.has(key)) return undefined;
  if (obj === null || typeof obj !== 'object') return undefined;
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return undefined;
  return (obj as Record<string, unknown>)[key];
}

/** path 逐段取自身属性；任一段缺失 / 危险 / 最终不是数组都返回 null */
function readPath(root: unknown, path: string): unknown[] | null {
  let cur: unknown = root;
  for (const p of path.split('.')) {
    if (p === '' || DANGEROUS_KEYS.has(p)) return null;
    cur = own(cur, p);
    if (cur === undefined) return null;
  }
  return Array.isArray(cur) ? cur : null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * markdown 展示单元：清控制字符 → HTML 转义 → markdown 语法字符转实体 → 换行压空格。
 * 实体在 markdown 解析阶段只是普通文本，浏览器渲染时才还原，
 * 因此既不会破列表 / 表格语法、也不会触发注入，用户看到的仍是原文。
 */
function cell(raw: unknown): string {
  const s = typeof raw === 'string' ? raw
    : (typeof raw === 'number' || typeof raw === 'boolean') ? String(raw)
      : '';
  // eslint-disable-next-line no-control-regex
  const cleaned = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return escapeHtml(cleaned)
    .replace(/\\/g, '&#92;')
    .replace(/\|/g, '&#124;')
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;')
    .replace(/\(/g, '&#40;')
    .replace(/\)/g, '&#41;')
    .replace(/\*/g, '&#42;')
    .replace(/_/g, '&#95;')
    .replace(/`/g, '&#96;')
    .replace(/\r?\n/g, ' ')
    .trim() || '—';
}

function scalar(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

/** 只放行不会逃出 markdown 链接语法的 http(s) 绝对 URL；否则返回 null（退化纯文本） */
function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const s = raw.trim();
  if (!/^https?:\/\//i.test(s)) return null;
  // 空白 / 尖括号 / 引号 / 反引号 / 反斜杠 / 括号 / 花括号 / 控制字符都可能破坏
  // [text](url) 语法或注入 href 属性，一律拒绝。
  // & 与 # 另加排除：它们本身合法，但 & 在 href 属性里需 HTML 转义（marked 的
  // 转义口径不该成为安全前提），# 会引入 fragment。这是通用保守策略：带 query /
  // fragment 的链接只退化为纯文本（文本仍完整显示），不拼可疑链接。
  // eslint-disable-next-line no-control-regex
  if (/[\s<>"'`\\()\[\]{}&#\u0000-\u001F]/.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

interface FieldSpec {
  key: string;
  label?: string;
  hrefKey?: string;
  subKey?: string;
}

interface DisplayArgs {
  url: string;
  path: string;
  format: 'list' | 'table';
  fields: FieldSpec[];
  note: string;
}

type ParseResult =
  | { ok: true; value: DisplayArgs }
  | { ok: false; error: string };

/** 严格校验模型传的「显示声明」；这里没有任何接口数据正文 */
function parseArgs(argsJson: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(argsJson);
  } catch {
    return { ok: false, error: '参数不是合法 JSON' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '参数必须是 JSON 对象' };
  }
  const r = raw as Record<string, unknown>;
  const url = typeof r['url'] === 'string' ? r['url'].trim() : '';
  if (!url) return { ok: false, error: '缺少 url（填 web_fetch 观察里的绝对 URL）' };
  const path = typeof r['path'] === 'string' ? r['path'].trim() : '';
  if (!path) return { ok: false, error: '缺少 path（数据数组的点分隔路径，由技能配方声明）' };

  const rf = r['format'];
  if (rf !== undefined && rf !== 'list' && rf !== 'table') {
    return { ok: false, error: 'format 只能是 list 或 table' };
  }
  const format: 'list' | 'table' = rf === 'table' ? 'table' : 'list';

  const rawFields = r['fields'];
  if (!Array.isArray(rawFields) || rawFields.length === 0) {
    return { ok: false, error: 'fields 必须是至少含 1 项的数组' };
  }
  const fields: FieldSpec[] = [];
  for (const item of rawFields) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: 'fields 每项必须是对象' };
    }
    const f = item as Record<string, unknown>;
    const key = typeof f['key'] === 'string' ? f['key'].trim() : '';
    if (!key) return { ok: false, error: 'fields 每项都要有非空 key' };
    if (DANGEROUS_KEYS.has(key)) {
      return { ok: false, error: 'fields 的 key 不能使用保留属性名' };
    }
    const spec: FieldSpec = { key };
    for (const k of ['label', 'hrefKey', 'subKey'] as const) {
      const v = f[k];
      if (typeof v === 'string' && v.trim()) spec[k] = v.trim();
      else if (v !== undefined && typeof v !== 'string') {
        return { ok: false, error: `fields 的 ${k} 必须是字符串` };
      }
    }
    fields.push(spec);
  }
  const note = typeof r['note'] === 'string' ? r['note'] : '';
  return { ok: true, value: { url, path, format, fields, note } };
}

/** 取一个字段的可显示文本；subKey 让「数组里取某属性」也由配方声明，宿主零假设 */
function fieldText(item: unknown, f: FieldSpec): string {
  let v = own(item, f.key);
  if (v !== undefined && f.subKey) {
    if (Array.isArray(v)) {
      const parts: string[] = [];
      for (const el of v) {
        const s = scalar(own(el, f.subKey));
        if (s !== null) parts.push(s);
      }
      v = parts.join('、');
    } else {
      v = own(v, f.subKey);
    }
  }
  return cell(v);
}

function fieldMarkdown(item: unknown, f: FieldSpec): string {
  const text = fieldText(item, f);
  if (f.hrefKey) {
    const href = safeHttpUrl(own(item, f.hrefKey));
    if (href) return `[${text}](${href})`;
  }
  return text;
}

/** 宿主按声明生成 markdown；不做任何业务字段判断 */
function buildMarkdown(items: unknown[], args: DisplayArgs): string {
  const lines: string[] = [];
  if (args.format === 'table') {
    lines.push('| ' + args.fields.map((f) => cell(f.label ?? f.key)).join(' | ') + ' |');
    lines.push('| ' + args.fields.map(() => '---').join(' | ') + ' |');
    for (const item of items) {
      lines.push('| ' + args.fields.map((f) => fieldMarkdown(item, f)).join(' | ') + ' |');
    }
  } else {
    const multi = args.fields.length > 1;
    for (const item of items) {
      const parts = args.fields.map((f) => {
        const md = fieldMarkdown(item, f);
        return multi && f.label ? `${cell(f.label)}：${md}` : md;
      });
      lines.push('- ' + parts.join(' · '));
    }
  }
  lines.push('');
  lines.push(`本次展示 **${items.length}** 条记录（按接口返回顺序）。`);
  if (args.note) lines.push(cell(args.note));
  return lines.join('\n');
}

function fail(reason: string): PrimitiveResult {
  return {
    observation: `display_json_list：${reason}。本次没能列出数据，请如实告诉用户，不要编造，也不要改 URL 反复重试。`,
    ok: false,
    detail: reason,
  };
}

/**
 * 构造通用展示原语。cache 与 web_fetch / web_cache_read 共用同一份 WebFetchCache：
 * 装配方传 webDeps.cache，未注入时落进程内默认单例（与 executeWebFetch 同口径）。
 */
export function createDisplayJsonListPrimitive(
  cache: WebFetchCache = defaultWebFetchCache,
): SkillPrimitive {
  return {
    name: DISPLAY_JSON_LIST_TOOL_NAME,
    definition: DISPLAY_JSON_LIST_TOOL,
    execute: async (argsJson: string): Promise<PrimitiveResult> => {
      const parsedArgs = parseArgs(argsJson);
      if (!parsedArgs.ok) return fail(parsedArgs.error);
      const args = parsedArgs.value;

      // 与 executeWebCacheRead 同口径规范化缓存键：模型照抄观察里的 URL 本就一致。
      let key = args.url;
      try {
        const u = new URL(key);
        if (u.protocol === 'http:' || u.protocol === 'https:') key = u.toString();
      } catch { /* 保留原串，下面按「没有缓存」报明确错误 */ }

      const entry = cache.get(key);
      if (!entry) {
        const known = cache.keys();
        const hint = known.length > 0
          ? `当前已缓存 ${known.length} 份：${known.join('、')}`
          : '当前没有任何缓存';
        return fail(`该 URL 没有缓存，请先用 web_fetch(storeOnly=true) 取回它。${hint}`);
      }
      if (!entry.ok) {
        return fail(`取回失败（HTTP ${entry.status} ${entry.statusText}），没有可展示的数据`);
      }
      let root: unknown;
      try {
        root = JSON.parse(entry.text);
      } catch {
        return fail('缓存正文不是合法 JSON（可能被拦截返回 HTML），没有可展示的数据');
      }
      if (!root || typeof root !== 'object' || Array.isArray(root)) {
        return fail('缓存正文不是 JSON 对象，没有可展示的数据');
      }
      const items = readPath(root, args.path);
      if (!items) {
        return fail(`path 没有指向数组（请按技能配方声明检查路径），没有可展示的数据`);
      }
      return {
        observation: `display_json_list：宿主已从缓存按声明生成 ${items.length} 条`
          + `${args.format === 'table' ? '表格' : '列表'}并直接展示给用户。`
          + '你不需要也不应该读取、复述或归纳数据内容；只写一句简短引导语并停笔，'
          + '不要调用 web_cache_read 把正文读回上下文。',
        ok: true,
        detail: `展示 ${items.length} 条记录（宿主渲染，正文未进上下文）`,
        displayMarkdown: buildMarkdown(items, args),
      };
    },
  };
}
