/**
 * 宿主通用展示原语：把「已是数组的 value」按调用方声明的字段渲染成列表 / 表格，
 * 直接展示给用户。纯渲染，不读缓存、不解析 JSON、不提取字段。
 * @module application/skill/primitives/DisplayJsonListPrimitive
 *
 * 职责收窄（阶段一，用户明令不兼容）：
 * - 本算子只做一件事：吃一个已解析好的数组 value，按 fields / format / note
 *   生成 markdown → displayMarkdown。url / path / subKey 三个旧参数及其全部
 *   处理逻辑（读 WebFetchCache、JSON.parse、readPath、subKey 投影）一律删除，
 *   不留桥、不双轨。
 * - 提取语义交给宿主内置算子 json_extract（承接已删 json-query 插件的
 *   path/where/pick 契约）；阶段二 workflow 把 json_extract 的 value 注入本算子的 value。
 * - 数据旁路仍然成立：displayMarkdown 由宿主直接渲染进用户可见层，
 *   绝不写进模型观察 / 回复文本 / ChatMessage.content，只作为独立字段落历史供
 *   renderSession 回放。
 *
 * 链路：PrimitiveResult.displayMarkdown → ToolOutcome → ToolLoopResult →
 * ChatUseCase.renderMessage 第 11 参 → AssistantRenderer 单独渲染 → ChatMessage
 * 独立字段（renderSession 回放）。ToolLoop 只把 observation 追加成 role:'tool'，
 * displayMarkdown 从构造到落地没有任何一步经过模型消息或 ChatMessage.content。
 *
 * 数值口径：行数 = 传入数组的实际长度；字段数 / 文本长度 / note 长度都不设
 * 截断阈值，避免引入无来源常数。format 缺省为 'list'，来源是 2026-11-20
 * 用户明确要求「默认用列表显示」。
 *
 * 安全边界（宿主强制；字段名来自调用方，必须防原型污染）：
 * - 属性访问只认自身属性，且拒绝 __proto__ / prototype / constructor。
 * - 每个外部值先清控制字符、escapeHtml，再把 markdown 语法字符转实体、换行压空格。
 * - 链接只接受 http(s) 绝对 URL 且不含空白 / 引号 / 括号 / 控制字符 / userinfo；
 *   保守起见也不收 & 与 #（带 query/fragment 的链接退化为纯文本，文本仍完整显示）。
 */

import type { ModelToolDefinition } from '@application/model/IModelGateway';
import type { SkillPrimitive, PrimitiveResult } from '@application/skill/SkillTypes';

export const DISPLAY_JSON_LIST_TOOL_NAME = 'display_json_list';

export const DISPLAY_JSON_LIST_TOOL: ModelToolDefinition = {
  name: DISPLAY_JSON_LIST_TOOL_NAME,
  description:
    '把已是数组的 value 按你声明的 fields / format 由宿主直接生成列表或表格展示给用户' +
    '（纯渲染，数据不进入模型上下文）。value 必须是已经解析好的数组：提取由宿主算子 ' +
    'json_extract 负责（阶段二 workflow 把它的 value 注入本算子的 value），本工具不读缓存、' +
    '不解析 JSON、不提取字段。fields 声明要显示哪些字段及顺序，format 省略时默认 list。' +
    '工具返回后只写一句简短引导语并停笔：不要复述、归纳或读取数据，也不要调用 web_cache_read 把正文读回上下文。',
  parameters: {
    type: 'object',
    properties: {
      value: {
        type: 'array',
        description:
          '已是数组的 value（由 json_extract 的 value 出参注入，或阶段一调用方直接传）。' +
          '本算子只吃数组，不解析 JSON 字符串、不按路径提取。',
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
          },
          required: ['key'],
          additionalProperties: false,
        },
        description: '要显示的字段与顺序，具体字段由调用方声明',
      },
      note: {
        type: 'string',
        description: '可选：末尾一行说明文字（静态文案，由调用方声明）',
      },
    },
    required: ['value'],
    additionalProperties: false,
  },
};

/** 字段名由调用方声明，访问时只认自身属性，并挡住原型链上的危险键 */
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function own(obj: unknown, key: string): unknown {
  if (!key || DANGEROUS_KEYS.has(key)) return undefined;
  if (obj === null || typeof obj !== 'object') return undefined;
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return undefined;
  return (obj as Record<string, unknown>)[key];
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
}

interface DisplayArgs {
  value: unknown[];
  format: 'list' | 'table';
  fields: FieldSpec[];
  note: string;
}

type ParseResult =
  | { ok: true; value: DisplayArgs }
  | { ok: false; error: string };

/** 严格校验调用方传的「显示声明 + 已解析数组」；这里不做任何提取或 JSON 解析 */
function parseArgs(args: Record<string, unknown>): ParseResult {
  let raw: unknown;
  try {
    raw = args;
  } catch {
    return { ok: false, error: '参数不是合法 JSON' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '参数必须是 JSON 对象' };
  }
  const r = raw as Record<string, unknown>;

  const value = r['value'];
  if (!Array.isArray(value)) {
    return { ok: false, error: '缺少 value（必须是已解析好的数组；提取请交给 json_extract）' };
  }

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
    for (const k of ['label', 'hrefKey'] as const) {
      const v = f[k];
      if (typeof v === 'string' && v.trim()) spec[k] = v.trim();
      else if (v !== undefined && typeof v !== 'string') {
        return { ok: false, error: `fields 的 ${k} 必须是字符串` };
      }
    }
    fields.push(spec);
  }
  const note = typeof r['note'] === 'string' ? r['note'] : '';
  return { ok: true, value: { value, format, fields, note } };
}

/** 取一个字段的可显示文本；纯渲染，不做任何子字段提取（那是 json_extract 的事） */
function fieldText(item: unknown, f: FieldSpec): string {
  return cell(own(item, f.key));
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
    observation: `display_json_list：${reason}。本次没能列出数据，请如实告诉用户，不要编造。`,
    ok: false,
    detail: reason,
  };
}

/** 构造通用展示原语。纯渲染，无缓存依赖、无网络、无时钟。 */
export function createDisplayJsonListPrimitive(): SkillPrimitive {
  return {
    name: DISPLAY_JSON_LIST_TOOL_NAME,
    definition: DISPLAY_JSON_LIST_TOOL,
    idempotent: true,
    outputSchema: { type: 'null' },
    kind: 'effect',
    execute: async (rawArgs: Record<string, unknown>): Promise<PrimitiveResult> => {
      const parsedArgs = parseArgs(rawArgs);
      if (!parsedArgs.ok) return fail(parsedArgs.error);
      const args = parsedArgs.value;
      return {
        observation: `display_json_list：宿主已按声明把 ${args.value.length} 条`
          + `${args.format === 'table' ? '表格' : '列表'}直接展示给用户。`
          + '你不需要也不应该读取、复述或归纳数据内容；只写一句简短引导语并停笔，'
          + '不要调用 web_cache_read 把正文读回上下文。',
        ok: true,
        detail: `展示 ${args.value.length} 条记录（纯渲染，正文未进上下文）`,
        displayMarkdown: buildMarkdown(args.value, args),
      };
    },
  };
}
