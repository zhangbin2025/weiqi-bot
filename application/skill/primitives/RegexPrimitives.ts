/**
 * 宿主内置正则算子：匹配 / 提取 / 替换（纯 value→value 计算）。
 * @module application/skill/primitives/RegexPrimitives
 *
 * 设计定位（2026-11-25）：把原先发布在 weiqi-assets 的
 * `workflow-operator.regex_extract` 插件能力下沉为宿主内置，走
 * `json_extract`（已删 json-query 插件下沉）同一条路径：
 * - 3 个独立算子，各管一件事，名字 snake_case、不带点，避开插件
 *   `<slug>.<method>` 命名空间（插件算子后注册会同名覆盖内置，故不重名）；
 * - 参数只描述正则语义，不含业务字段名（key / label / note 属展示层，
 *   由配方与 display_json_list 声明）；
 * - value 出参就是结果本体（数组 / 布尔 / 字符串），不套 `{matches,count}`
 *   这类插件时代的包装，连线只认 value，与 json_extract 口径一致；
 * - 纯计算：零网络 / 零时钟 / 零随机数 / 零存储，不读缓存、不解析配方；
 *   observation 只给一句摘要，不把正文塞进模型上下文。
 *
 * 参数与缺省的出处（不引入拟合常数）：
 * - `pattern` / `flags` / 捕获组下标 / `replacement` 全部沿用 ECMAScript
 *   `RegExp` 与 `String.prototype.replace` 的标准语义；`replacement` 里的
 *   `$1` / `$&` 等由引擎解释，宿主不自造替换语法。
 * - `flags` 缺省：extract / replace 为 'g'、test 为 ''。这不是阈值，
 *   而是「全局提取/替换」「只判定是否匹配」两种语义的直接对应；
 *   调用方不传即用该语义，显式传则完全交给引擎（含 'g' 与否）。
 * - `group` 缺省 0 = 整体命中；越界/未参与匹配的组按空串（来源：
 *   RegExp.exec 的 undefined 结果，插件旧实现同口径）。
 * - `unique` 缺省 false = 保留全部命中，按出现顺序；`unique:true` 时按
 *   首次出现顺序去重（业务明说的规则，不是阈值）。
 * - `withIndex` 缺省 false = 命中文本数组；true 时每项为
 *   `{value, index}`，可直接交给 display_json_list 按字段展示。
 * - `limit` 缺省 0 = 不限条数；只接受正整数，由调用方显式声明上限
 *   （如配方里写 50 是明说的业务约束），宿主不内置任何默认条数。
 * - 空匹配推进 lastIndex：ECMAScript 的 `RegExp.prototype.exec` 在零宽
 *   命中时不自动前进，手动 +1 是循环终止的**语义需要**，不是经验数值；
 *   单调推进保证必然结束，无需另设循环次数上限。
 * - flags 不做静默过滤：非法标志（含 'y' 等）交给 `new RegExp` 抛错，
 *   由 fail() 结构化回灌，不偷偷吞掉调用方传的参数。
 */

import type { ModelToolDefinition } from '@application/model/IModelGateway';
import type { SkillPrimitive, PrimitiveResult } from '@application/skill/SkillTypes';

export const REGEX_MATCH_TOOL_NAME = 'regex_match';
export const REGEX_EXTRACT_TOOL_NAME = 'regex_extract';
export const REGEX_REPLACE_TOOL_NAME = 'regex_replace';

/** 三算子共用的必填参数说明；pattern 是正则源字符串，不是正则字面量。 */
const TEXT_PROP = {
  type: 'string',
  description: '源文本（纯字符串；阶段二 workflow runner 用 {from,as} 把上游 value 注入）。',
} as const;
const PATTERN_PROP = {
  type: 'string',
  description: '正则表达式源字符串（JSON 字符串里反斜杠按 JSON 规则转义），不是 /.../ 字面量。',
} as const;
const FLAGS_PROP = (fallback: string) => ({
  type: 'string',
  description: `正则标志，原样交给 ECMAScript RegExp 引擎（非法标志会明确报错，不静默过滤）；省略时缺省 '${fallback}'。`,
}) as const;

export const REGEX_MATCH_TOOL: ModelToolDefinition = {
  name: REGEX_MATCH_TOOL_NAME,
  description:
    '对文本做一次正则匹配，返回首个命中的结构信息（纯计算、零网络、零时钟）。'
    + 'flags 省略时为单次匹配；显式传 g/y 会因 lastIndex 状态导致结果不确定，故拒绝，'
    + '需要取全部命中请用 regex_extract。结果作为纯 value 出参，正文不进模型上下文。',
  parameters: {
    type: 'object',
    properties: {
      text: TEXT_PROP,
      pattern: PATTERN_PROP,
      flags: FLAGS_PROP(''),
    },
    required: ['text', 'pattern'],
    additionalProperties: false,
  },
};

export const REGEX_EXTRACT_TOOL: ModelToolDefinition = {
  name: REGEX_EXTRACT_TOOL_NAME,
  description:
    '对文本做正则全局提取，按捕获组或整体命中返回数组（纯计算、零网络、零时钟）。'
    + 'flags 省略时缺省 g（不含 g 时自动补，保证 exec 循环推进）；group 省略为 0 = 整体命中；'
    + 'unique:true 按出现顺序去重；withIndex:true 每项为 {value,index}；limit 只接受'
    + '调用方显式给的正整数，省略则不限条数。输出数组可直接交给 display_json_list，'
    + '也可经 json_extract 投影后再展示。结果作为纯 value 出参，正文不进模型上下文。',
  parameters: {
    type: 'object',
    properties: {
      text: TEXT_PROP,
      pattern: PATTERN_PROP,
      flags: FLAGS_PROP('g'),
      group: {
        type: 'integer',
        description: '取第几个捕获组；省略为 0 = 整体命中。越界或未参与匹配的组按空串处理。',
      },
      unique: {
        type: 'boolean',
        description: '省略为 false = 保留全部命中；true = 按首次出现顺序去重。',
      },
      withIndex: {
        type: 'boolean',
        description: '省略为 false = 输出命中文本数组；true = 输出 {value,index} 对象数组。',
      },
      limit: {
        type: 'integer',
        description: '可选：最多返回多少条（正整数，由调用方显式声明业务上限）；省略 = 不限条数。宿主不设默认条数。',
      },
    },
    required: ['text', 'pattern'],
    additionalProperties: false,
  },
};

export const REGEX_REPLACE_TOOL: ModelToolDefinition = {
  name: REGEX_REPLACE_TOOL_NAME,
  description:
    '按正则替换文本（纯计算、零网络、零时钟）。flags 省略时缺省 g（全局替换）；'
    + '显式传不含 g 的 flags 则只替换首个命中，完全遵循 ECMAScript 语义。'
    + 'replacement 里的 $1 / $& / $$ 等替换模式由引擎解释，宿主不自造语法。'
    + '结果字符串作为纯 value 出参，正文不进模型上下文。',
  parameters: {
    type: 'object',
    properties: {
      text: TEXT_PROP,
      pattern: PATTERN_PROP,
      replacement: {
        type: 'string',
        description: '替换文本；$1 / $& / $$ 等按 String.prototype.replace 标准语义解释。',
      },
      flags: FLAGS_PROP('g'),
    },
    required: ['text', 'pattern', 'replacement'],
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------- 参数解析（严格、无隐式兜底）

interface ParsedArgs {
  text: string;
  pattern: string;
  flags: string;
  group: number;
  unique: boolean;
  withIndex: boolean;
  limit: number;
  replacement: string;
  /** replacement 是否由调用方显式给出（regex_replace 必填，空串也算显式给出） */
  hasReplacement: boolean;
}

function parseArgs(args: Record<string, unknown>, fallbackFlags: string): { ok: true; value: ParsedArgs } | { ok: false; error: string } {
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

  if (typeof r['text'] !== 'string') return { ok: false, error: 'text 必须是字符串' };
  if (typeof r['pattern'] !== 'string') return { ok: false, error: 'pattern 必须是字符串' };

  let flags = fallbackFlags;
  if (r['flags'] !== undefined) {
    if (typeof r['flags'] !== 'string') return { ok: false, error: 'flags 必须是字符串' };
    flags = r['flags'];
  }

  let group = 0;
  if (r['group'] !== undefined) {
    if (typeof r['group'] !== 'number' || !Number.isInteger(r['group']) || r['group'] < 0) {
      return { ok: false, error: 'group 必须是非负整数' };
    }
    group = r['group'];
  }

  let unique = false;
  if (r['unique'] !== undefined) {
    if (typeof r['unique'] !== 'boolean') return { ok: false, error: 'unique 必须是布尔值' };
    unique = r['unique'];
  }

  let withIndex = false;
  if (r['withIndex'] !== undefined) {
    if (typeof r['withIndex'] !== 'boolean') return { ok: false, error: 'withIndex 必须是布尔值' };
    withIndex = r['withIndex'];
  }

  let limit = 0;
  if (r['limit'] !== undefined) {
    if (typeof r['limit'] !== 'number' || !Number.isInteger(r['limit']) || r['limit'] <= 0) {
      return { ok: false, error: 'limit 必须是正整数（省略 = 不限条数）' };
    }
    limit = r['limit'];
  }

  const hasReplacement = r['replacement'] !== undefined;
  let replacement = '';
  if (hasReplacement) {
    if (typeof r['replacement'] !== 'string') return { ok: false, error: 'replacement 必须是字符串' };
    replacement = r['replacement'];
  }

  return {
    ok: true,
    value: {
      text: r['text'], pattern: r['pattern'], flags, group,
      unique, withIndex, limit, replacement, hasReplacement,
    },
  };
}

/** 统一的失败回执：一句人话 + detail，不产出 value，不回灌正文。 */
function fail(tool: string, reason: string): PrimitiveResult {
  return {
    observation: `${tool}：${reason}。本次没有产出 value，请如实告诉用户，不要编造。`,
    ok: false,
    detail: reason,
  };
}

/** 构造正则：flags 原样交给引擎，非法标志自然抛错；不静默过滤任何字符。 */
function buildRegExp(pattern: string, flags: string): RegExp {
  return new RegExp(pattern, flags);
}

/** 三算子共用的执行骨架：解析参数 → 纯计算 → 摘要观察。 */
function runPrimitive(
  toolName: string,
  fallbackFlags: string,
  args: Record<string, unknown>,
  compute: (a: ParsedArgs) => { value: unknown; summary: string },
  requireReplacement = false,
): PrimitiveResult {
  const parsed = parseArgs(args, fallbackFlags);
  if (!parsed.ok) return fail(toolName, parsed.error);
  if (requireReplacement && !parsed.value.hasReplacement) {
    return fail(toolName, 'replacement 必填（不能省略，空串须显式传）');
  }
  try {
    const { value, summary } = compute(parsed.value);
    return {
      observation: `${toolName}：${summary}（纯 value 出参，正文未写入上下文）。`,
      ok: true,
      detail: summary,
      value,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return fail(toolName, `正则执行失败：${reason}`);
  }
}

// ---------------------------------------------------------------- 三个算子

/** regex_match：首个命中的结构信息；g/y 会引入 lastIndex 状态，明确拒绝。 */
export function createRegexMatchPrimitive(): SkillPrimitive {
  return {
    name: REGEX_MATCH_TOOL_NAME,
    definition: REGEX_MATCH_TOOL,
    idempotent: true,
    execute: async (args: Record<string, unknown>): Promise<PrimitiveResult> => runPrimitive(
      REGEX_MATCH_TOOL_NAME, '', args,
      (a) => {
        if (a.flags.includes('g') || a.flags.includes('y')) {
          throw new Error('regex_match 只做单次匹配，flags 不能含 g / y（请用 regex_extract 取全部命中）');
        }
        const m = buildRegExp(a.pattern, a.flags).exec(a.text);
        if (m === null) {
          return { value: { matched: false }, summary: '未命中' };
        }
        const groups: string[] = [];
        for (let i = 1; i < m.length; i++) {
          groups.push(m[i] === undefined ? '' : String(m[i]));
        }
        return {
          value: {
            matched: true,
            match: m[0],
            index: m.index,
            groups,
          },
          summary: '命中 1 处',
        };
      },
    ),
  };
}

/** regex_extract：全局提取，输出命中文本数组或 {value,index} 对象数组。 */
export function createRegexExtractPrimitive(): SkillPrimitive {
  return {
    name: REGEX_EXTRACT_TOOL_NAME,
    definition: REGEX_EXTRACT_TOOL,
    idempotent: true,
    execute: async (args: Record<string, unknown>): Promise<PrimitiveResult> => runPrimitive(
      REGEX_EXTRACT_TOOL_NAME, 'g', args,
      (a) => {
        // 不含 g 自动补：exec 循环需要 lastIndex 推进，否则原地死循环。
        // 这是循环语义需要，不是对调用方 flags 的篡改（显式传的其余标志原样保留）。
        const flags = a.flags.includes('g') ? a.flags : a.flags + 'g';
        const re = buildRegExp(a.pattern, flags);
        const out: Array<string | { value: string; index: number }> = [];
        const seen = new Set<string>();
        let m: RegExpExecArray | null;
        while ((m = re.exec(a.text)) !== null) {
          const val = m[a.group] === undefined ? '' : String(m[a.group]);
          const zeroWidth = m[0] === '';
          if (a.unique && seen.has(val)) {
            if (zeroWidth) re.lastIndex += 1;
            continue;
          }
          if (a.unique) seen.add(val);
          out.push(a.withIndex ? { value: val, index: m.index } : val);
          if (a.limit > 0 && out.length >= a.limit) break;
          // 零宽命中时 exec 不推进 lastIndex，手动 +1 保证循环单调前进、必然终止。
          if (zeroWidth) re.lastIndex += 1;
        }
        return { value: out, summary: `提取 ${out.length} 条命中` };
      },
    ),
  };
}

/** regex_replace：按标准语义替换，flags 缺省 g；不强制补 g（允许只换首个）。 */
export function createRegexReplacePrimitive(): SkillPrimitive {
  return {
    name: REGEX_REPLACE_TOOL_NAME,
    definition: REGEX_REPLACE_TOOL,
    idempotent: true,
    execute: async (args: Record<string, unknown>): Promise<PrimitiveResult> => runPrimitive(
      REGEX_REPLACE_TOOL_NAME, 'g', args,
      (a) => {
        const re = buildRegExp(a.pattern, a.flags);
        const value = a.text.replace(re, a.replacement);
        return { value, summary: '替换完成' };
      },
      true,
    ),
  };
}

/** 工厂：一次性给出 3 个内置算子，供 createBasicPrimitives() 展开注册。 */
export function createRegexPrimitives(): SkillPrimitive[] {
  return [
    createRegexMatchPrimitive(),
    createRegexExtractPrimitive(),
    createRegexReplacePrimitive(),
  ];
}
