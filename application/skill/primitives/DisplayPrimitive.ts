/**
 * 宿主通用 display 原语：展示任意 JSON 结构或 Markdown 文本。
 * 字符串按 Markdown 原样展示；数组自动生成列表/表格；对象按层级生成 Markdown。
 * 结构化数据由宿主转换为 displayMarkdown，正文不进入模型上下文。
 * @module application/skill/primitives/DisplayPrimitive
 *
 * 字段访问仅允许自身属性，并拒绝原型相关保留键；结构化值统一转义后再进入 Markdown。
 * display 不联网、不读缓存、不解析 JSON 字符串，也不执行业务逻辑。
 */

import type { ModelToolDefinition } from '@application/model/IModelGateway';
import type { SkillPrimitive, PrimitiveResult } from '@application/skill/SkillTypes';

export const DISPLAY_TOOL_NAME = 'display';

export const DISPLAY_TOOL: ModelToolDefinition = {
  name: DISPLAY_TOOL_NAME,
  description:
    '把任意 JSON 数据或 Markdown 文本直接展示给用户（纯渲染，数据不进入模型上下文）。' +
    '字符串按 Markdown 展示；数组自动生成列表或表格；对象按层级生成 Markdown；' +
    '可用 format 和 fields 自定义数组展示形态。不读缓存、不联网、不做业务判断。' +
    '工具返回后只写一句简短引导语并停笔：不要复述、归纳或读取数据。',
  parameters: {
    type: 'object',
    properties: {
      value: {
        description: '任意 JSON 值；字符串可直接提供 Markdown 文本。',
      },
      format: {
        type: 'string',
        enum: ['auto', 'markdown', 'list', 'table'],
        description: '展示形态；省略时 auto 根据数据结构选择',
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
  value: unknown;
  format: 'auto' | 'markdown' | 'list' | 'table';
  fields: FieldSpec[];
  note: string;
}

type ParseResult =
  | { ok: true; value: DisplayArgs }
  | { ok: false; error: string };

/** 严格校验调用方传的「显示声明 + 已解析数组」；这里不做任何提取或 JSON 解析 */
function parseArgs(args: Record<string, unknown>): ParseResult {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, error: '参数必须是 JSON 对象' };
  }
  const value = args['value'];
  if (value === undefined) return { ok: false, error: '缺少 value 参数' };
  const rawFormat = args['format'];
  if (rawFormat !== undefined && !['auto', 'markdown', 'list', 'table'].includes(String(rawFormat))) {
    return { ok: false, error: 'format 只允许 auto、markdown、list 或 table' };
  }
  const format = rawFormat === undefined ? 'auto' : rawFormat as DisplayArgs['format'];
  if (format === 'markdown' && typeof value !== 'string') {
    return { ok: false, error: 'format=markdown 时 value 必须是字符串' };
  }
  const fields: FieldSpec[] = [];
  if (args['fields'] !== undefined) {
    if (!Array.isArray(args['fields']) || args['fields'].length === 0) {
      return { ok: false, error: 'fields 若给必须是非空数组' };
    }
    for (const item of args['fields']) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return { ok: false, error: 'fields 每项必须是对象' };
      }
      const f = item as Record<string, unknown>;
      const key = typeof f['key'] === 'string' ? f['key'].trim() : '';
      if (!key || DANGEROUS_KEYS.has(key)) return { ok: false, error: 'fields.key 必须是非保留属性名' };
      const spec: FieldSpec = { key };
      for (const k of ['label', 'hrefKey'] as const) {
        const v = f[k];
        if (typeof v === 'string' && v.trim()) spec[k] = v.trim();
        else if (v !== undefined && typeof v !== 'string') return { ok: false, error: `fields 的 ${k} 必须是字符串` };
      }
      fields.push(spec);
    }
  }
  if ((format === 'list' || format === 'table') && !Array.isArray(value)) {
    return { ok: false, error: `format=${format} 时 value 必须是数组` };
  }
  const note = typeof args['note'] === 'string' ? args['note'] : '';
  return { ok: true, value: { value, format, fields, note } };
}

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
function renderObject(value: Record<string, unknown>, depth: number): string[] {
  const lines: string[] = [];
  const indent = '  '.repeat(depth);
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    const item = value[key];
    if (item !== null && typeof item === 'object') {
      lines.push(indent + '- **' + cell(key) + '**');
      if (Array.isArray(item)) {
        for (const child of item) {
          if (child !== null && typeof child === 'object') {
            lines.push(...renderObject(child as Record<string, unknown>, depth + 1));
          } else lines.push('  '.repeat(depth + 1) + '- ' + cell(child));
        }
      } else lines.push(...renderObject(item as Record<string, unknown>, depth + 1));
    } else {
      lines.push(indent + '- **' + cell(key) + '**：' + cell(item));
    }
  }
  return lines;
}

/** 任意 JSON 值 → Markdown；字符串 Markdown 原样展示，结构化值由宿主生成。 */
function buildMarkdown(value: unknown, args: DisplayArgs): string {
  let markdown: string;
  if (typeof value === 'string') {
    markdown = value;
  } else if (Array.isArray(value)) {
    const items = value;
    let fields = args.fields;
    let format = args.format;
    const allObjects = items.length > 0 && items.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item));
    if (fields.length === 0 && allObjects) {
      const keys = Object.keys(items[0] as Record<string, unknown>).filter((key) => !DANGEROUS_KEYS.has(key));
      fields = keys.map((key) => ({ key }));
    }
    if (format === 'auto') format = allObjects ? 'table' : 'list';
    if (fields.length === 0) fields = [{ key: 'value' }];
    const lines: string[] = [];
    if (format === 'table') {
      lines.push('| ' + fields.map((f) => cell(f.label ?? f.key)).join(' | ') + ' |');
      lines.push('| ' + fields.map(() => '---').join(' | ') + ' |');
      for (const item of items) {
        lines.push('| ' + fields.map((f) => Array.isArray(item) || item === null || typeof item !== 'object'
          ? cell(item) : fieldMarkdown(item, f)).join(' | ') + ' |');
      }
    } else {
      for (const item of items) {
        if (fields.length === 1 && fields[0]!.key === 'value') {
          if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
            lines.push(...renderObject(item as Record<string, unknown>, 1));
          } else if (Array.isArray(item)) {
            lines.push(...item.map((child) => '  - ' + cell(child)));
          } else lines.push('- ' + cell(item));
        } else lines.push('- ' + fields.map((f) => {
          const md = fieldMarkdown(item, f);
          return fields.length > 1 && f.label ? cell(f.label) + '：' + md : md;
        }).join(' · '));
      }
    }
    if (items.length === 0) lines.push('（空列表）');
    markdown = lines.join('\n');
  } else if (value !== null && typeof value === 'object') {
    markdown = renderObject(value as Record<string, unknown>, 0).join('\n') || '（空对象）';
  } else {
    markdown = cell(value);
  }
  if (args.note) markdown += (markdown ? '\n\n' : '') + cell(args.note);
  return markdown;
}

function fail(reason: string): PrimitiveResult {
  return {
    observation: `display：${reason}。本次没能列出数据，请如实告诉用户，不要编造。`,
    ok: false,
    detail: reason,
  };
}

/** 构造通用展示原语。纯渲染，无缓存依赖、无网络、无时钟。 */
export function createDisplayPrimitive(): SkillPrimitive {
  return {
    name: DISPLAY_TOOL_NAME,
    definition: DISPLAY_TOOL,
    idempotent: true,
    outputSchema: { type: 'null' },
    kind: 'effect',
    execute: async (rawArgs: Record<string, unknown>): Promise<PrimitiveResult> => {
      const parsedArgs = parseArgs(rawArgs);
      if (!parsedArgs.ok) return fail(parsedArgs.error);
      const args = parsedArgs.value;
      return {
        observation: `display：宿主已按声明展示数据。`
          + '你不需要也不应该读取、复述或归纳数据内容；只写一句简短引导语并停笔，'
          + '不要调用 web_cache_read 把正文读回上下文。',
        ok: true,
        detail: '已展示数据（纯渲染，正文未进上下文）',
        displayMarkdown: buildMarkdown(args.value, args),
      };
    },
  };
}
