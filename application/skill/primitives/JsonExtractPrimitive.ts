/**
 * 宿主内置算子 json_extract：纯 value→value 的 JSON 提取（路径选取 / 条件筛选 / 字段投影）。
 * @module application/skill/primitives/JsonExtractPrimitive
 *
 * 职责收窄（阶段一）：display_json_list 原来混装的「读 WebFetchCache + JSON.parse +
 * readPath + subKey 投影」全部拆出来，由本算子承接；json-query 插件（已删）的
 * path / where / pick 契约也沉到这里，成为宿主内置能力，不再需要插件工件。
 *
 * 边界（硬性，逐条可查）：
 * - 纯计算：零网络、零时钟、零随机数。不调 fetch、不读 WebFetchCache、
 *   不用 Date / Math.random；所有输入都来自参数 value（阶段一由调用方直接传，
 *   阶段二 workflow runner 用 {from,as} 把上游 value 注入）。
 * - 阶段一不解析配方、不读缓存；阶段二 workflow runner 把上游 value 注入本算子。
 * - 不设任何阈值 / limit / 默认深度 / 默认条数。已删 json-query 插件的
 *   limit / count / paths 若要保留，只能作为「显式传入的可选参数」存在（不传就不生效）；
 *   本实现按最小集只搬 path / where / pick，足够承接 display 的 readPath/subKey 语义
 *   与弈友分析需求，不强行搬全部（来源：已删 json-query 插件的显式参数，不是拟合值）。
 *
 * 参数契约来源（不引入新 magic number，语法按已删插件既有实现照搬，不自造）：
 * - path / where / pick 三个参数的形状与语义，逐字继承
 *   weiqi-assets 仓库已删除的 json-query 插件（其 plugin.json 的 query 契约与 index.js 实现）：
 *   · path（对应旧插件的 select）：支持 $.a.b[0].c / a.b[0].c / [*] / [] / .* /
 *     [-1] 负下标 / ["含特殊字符的键"] / ..name 递归下降；省略或 '$' 为根节点。
 *   · where：条件数组，项间 AND；每项 {path?, op, value?, flags?}；
 *     op 沿用 exists/eq/ne/in/contains/startsWith/endsWith/gt/gte/lt/lte/match。
 *   · pick：只保留这些顶层字段；对数组逐元素投影（承接 display 原 subKey
 *     「从数组每项取一个子字段」的语义；display 的 subKey 只能对一个字段取子键，
 *     这里 pick 是通用的逐元素投影）。
 *   · value：上游 value（旧插件是 json / text 二选一；阶段一直接传已解析的值，
 *     不再做 JSON.parse —— 解析正文是 web_fetch / 阶段二 runner 的职责）。
 * - 路径语法、深度相等、比较不做隐式类型转换、正则 flags 禁 g/y、
 *   广度优先显式队列（不递归，避免深结构爆栈）等，全部按旧插件 index.js 语义移植。
 *
 * 返回值：{ value: <提取结果> } 作为 PrimitiveResult.value（阶段二连线只认它）；
 * observation 只给一句人类可读摘要（说明匹配数 / 返回数，不把正文塞进上下文）；
 * ok / detail 按现有原语口径。渲染由 display_json_list 负责，动作由 actionLink 负责。
 */

import type { ModelToolDefinition } from '@application/model/IModelGateway';
import type { SkillPrimitive, PrimitiveResult } from '@application/skill/SkillTypes';

export const JSON_EXTRACT_TOOL_NAME = 'json_extract';

export const JSON_EXTRACT_TOOL: ModelToolDefinition = {
  name: JSON_EXTRACT_TOOL_NAME,
  description:
    '对上游 value 做确定性的 JSON 提取，纯计算、零网络、零时钟：按 path 选取节点、' +
    '按 where 逐项筛选、按 pick 投影字段，结果作为纯 value 出参（阶段二 workflow 连线只认它）。' +
    'path 语法继承已删 json-query 插件（$.a.b[0].c / a.b[*] / [-1] / ["键"] / ..name，省略为根节点）；' +
    'where 项间 AND，op 见定义；pick 只保留指定顶层字段并对数组逐元素投影。' +
    'value 由上游直接传入（阶段一调用方给，阶段二 DAG runner 注入），本算子不读缓存、不解析正文。',
  parameters: {
    type: 'object',
    properties: {
      value: {
        description:
          '上游 value（已解析的 JSON 值：对象 / 数组 / 标量）。阶段一由调用方直接传；' +
          '阶段二 workflow runner 用 {from,as} 注入。来源：已删 json-query 插件 query 的 json/text 二选一，' +
          '这里只接已解析值，不做 JSON.parse。',
      },
      path: {
        type: 'string',
        description:
          '路径表达式，从 value 里按路径取数组/节点。语法继承已删 json-query 插件的 select：' +
          '$.a.b[0].c 或 a.b[0].c（点分隔对象键）、[*] / [] / .*（展开当前层全部子节点）、' +
          '[-1]（倒数第 n 个）、["含特殊字符的键"]（JSON 字符串转义）、..name（自身及全部后代含该键者）。' +
          '省略或 "$" 表示根节点。按已删插件已有语法实现，不自造。',
      },
      where: {
        type: 'array',
        items: { type: 'object' },
        description:
          '条件数组，项间 AND；每项 {path?, op, value?, flags?}。op 沿用已删 json-query 插件：' +
          'exists / eq / ne / in / contains / startsWith / endsWith / gt / gte / lt / lte / match。' +
          'path 省略或 "$" 表示当前候选节点自身；同一路径命中多个节点时任一满足即通过（some 语义）。' +
          'match 的 flags 禁 g / y（会引入 lastIndex 状态使结果不确定）。来源：已删插件 query 的 where 契约。',
      },
      pick: {
        type: 'array',
        items: { type: 'string' },
        description:
          '只保留这些顶层字段；对数组逐元素投影。承接 display 原来的 subKey 语义' +
          '（从数组每项取一个子字段），也承接已删 json-query 插件 query 的 pick 契约。',
      },
    },
    required: [],
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------- 纯 JSON 工具（沿用已删插件语义）

/** 纯 JSON 值深度相等：NaN / Date / 循环引用不会出现（输入来自 JSON） */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.length !== kb.length) return false;
    for (let j = 0; j < ka.length; j++) {
      if (ka[j] !== kb[j]
        || !deepEqual((a as Record<string, unknown>)[ka[j]!], (b as Record<string, unknown>)[kb[j]!])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isScalar(v: unknown): boolean {
  return v === null || typeof v === 'string' || typeof v === 'number'
    || typeof v === 'boolean';
}

/** 属性访问只认自身属性，并挡住原型链上的危险键（与 display 渲染层同口径） */
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

// ---------------------------------------------------------------- 路径表达式（照搬已删插件 index.js）

type Token =
  | { kind: 'key'; name: string }
  | { kind: 'index'; n: number }
  | { kind: 'any' }
  | { kind: 'descend'; name: string };

function readBareName(s: string, i: number): { name: string; next: number } {
  let j = i;
  while (j < s.length && s.charAt(j) !== '.' && s.charAt(j) !== '[') j++;
  if (j === i) return { name: '', next: i };
  return { name: s.slice(i, j), next: j };
}

function readQuoted(s: string, i: number): { name: string; next: number } {
  let j = i + 1;
  let buf = '';
  while (j < s.length) {
    const c = s.charAt(j);
    if (c === '\\') {
      buf += c + (s.charAt(j + 1) || '');
      j += 2;
      continue;
    }
    if (c === '"') break;
    buf += c;
    j++;
  }
  if (s.charAt(j) !== '"') throw new Error('路径 ["..."] 缺少收尾引号');
  let name: string;
  try {
    name = JSON.parse('"' + buf + '"') as string;
  } catch {
    throw new Error('路径键名转义非法');
  }
  j++;
  if (s.charAt(j) !== ']') throw new Error('路径 ["..."] 后缺少 ]');
  return { name, next: j + 1 };
}

function readIndex(s: string, i: number): { n: number; next: number } {
  let j = i;
  let sign = 1;
  if (s.charAt(j) === '-') {
    sign = -1;
    j++;
  }
  const start = j;
  while (j < s.length && s.charAt(j) >= '0' && s.charAt(j) <= '9') j++;
  if (j === start) throw new Error('路径下标必须是整数：位置 ' + i);
  if (s.charAt(j) !== ']') throw new Error('路径下标后缺少 ]');
  return { n: sign * Number(s.slice(start, j)), next: j + 1 };
}

/**
 * 路径语法（自定义，来自已删 json-query 插件，逐条见其 README）：
 *   $                 根节点，可省略
 *   .name             对象键；也可在开头直接写 name
 *   ["name"]          含特殊字符的键，转义交给 JSON 规则
 *   [n] / [-n]        数组下标 / 倒数第 n 个
 *   [*] / [] / .*     展开当前层全部子节点
 *   ..name            当前节点自身及所有后代中含该键者
 * 段可连续书写：$.Years.2027[*].Name
 */
function parsePath(expr: string): Token[] {
  const s = expr.trim();
  if (s === '' || s === '$') return [];
  let i = 0;
  if (s.charAt(0) === '$') i = 1;
  const tokens: Token[] = [];
  while (i < s.length) {
    const c = s.charAt(i);
    if (c === '.') {
      i++;
      if (s.charAt(i) === '.') {
        i++;
        const d = readBareName(s, i);
        if (!d.name) throw new Error('.. 后必须跟键名');
        tokens.push({ kind: 'descend', name: d.name });
        i = d.next;
      } else if (s.charAt(i) === '*') {
        i++;
        tokens.push({ kind: 'any' });
      } else if (s.charAt(i) === '[') {
        // 允许 .[ 这种写法，交给下一轮处理
      } else {
        const b = readBareName(s, i);
        if (!b.name) throw new Error('路径 . 后缺少键名：位置 ' + i);
        tokens.push({ kind: 'key', name: b.name });
        i = b.next;
      }
    } else if (c === '[') {
      i++;
      if (s.charAt(i) === ']') {
        i++;
        tokens.push({ kind: 'any' });
      } else if (s.charAt(i) === '*') {
        i++;
        if (s.charAt(i) !== ']') throw new Error('[*] 后缺少 ]');
        i++;
        tokens.push({ kind: 'any' });
      } else if (s.charAt(i) === '"') {
        const q = readQuoted(s, i);
        tokens.push({ kind: 'key', name: q.name });
        i = q.next;
      } else {
        const n = readIndex(s, i);
        tokens.push({ kind: 'index', n: n.n });
        i = n.next;
      }
    } else {
      const bare = readBareName(s, i);
      if (!bare.name) throw new Error('路径无法解析：位置 ' + i);
      tokens.push({ kind: 'key', name: bare.name });
      i = bare.next;
    }
  }
  return tokens;
}

interface Hit { path: string; value: unknown }

/** 把一个节点的全部直接子节点按原顺序放进队列（危险键不展开，防原型污染） */
function pushChildren(queue: Hit[], node: unknown, path: string): void {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      queue.push({ path: path + '[' + i + ']', value: node[i] });
    }
  } else if (isObj(node)) {
    for (const k of Object.keys(node)) {
      if (DANGEROUS_KEYS.has(k)) continue;
      queue.push({ path: appendKey(path, k), value: node[k] });
    }
  }
}

/** 输出路径用的键表示：无特殊字符用 .name，否则用 ["..."]，可原样回贴给 parsePath */
function appendKey(p: string, name: string): string {
  if (/^[^.\[\]"\s]+$/.test(name)) return p + '.' + name;
  return p + '[' + JSON.stringify(name) + ']';
}

/** 按 token 序列选出命中节点；广度优先 + 显式队列，结果顺序确定且无递归 */
function walk(root: unknown, tokens: Token[]): Array<{ path: string; value: unknown }> {
  const queue: Array<{ node: unknown; idx: number; path: string }> = [
    { node: root, idx: 0, path: '$' },
  ];
  let head = 0;
  const out: Array<{ path: string; value: unknown }> = [];
  while (head < queue.length) {
    const cur = queue[head++]!;
    if (cur.idx >= tokens.length) {
      out.push({ path: cur.path, value: cur.node });
      continue;
    }
    const t = tokens[cur.idx]!;
    const nxt = cur.idx + 1;
    if (t.kind === 'key') {
      if (isObj(cur.node) && !DANGEROUS_KEYS.has(t.name) && hasOwn(cur.node, t.name)) {
        queue.push({ node: cur.node[t.name], idx: nxt, path: appendKey(cur.path, t.name) });
      }
    } else if (t.kind === 'index') {
      if (Array.isArray(cur.node)) {
        const n = t.n < 0 ? cur.node.length + t.n : t.n;
        if (n >= 0 && n < cur.node.length) {
          queue.push({ node: cur.node[n], idx: nxt, path: cur.path + '[' + n + ']' });
        }
      }
    } else if (t.kind === 'any') {
      const direct: Hit[] = [];
      pushChildren(direct, cur.node, cur.path);
      for (const d of direct) queue.push({ node: d.value, idx: nxt, path: d.path });
    } else if (t.kind === 'descend') {
      const sub: Hit[] = [{ path: cur.path, value: cur.node }];
      let sh = 0;
      const found: Array<{ node: unknown; idx: number; path: string }> = [];
      while (sh < sub.length) {
        const d = sub[sh++]!;
        if (isObj(d.value) && !DANGEROUS_KEYS.has(t.name) && hasOwn(d.value, t.name)) {
          found.push({ node: d.value[t.name], idx: nxt, path: appendKey(d.path, t.name) });
        }
        pushChildren(sub, d.value, d.path);
      }
      for (const f of found) queue.push(f);
    }
  }
  return out;
}

// ---------------------------------------------------------------- 条件筛选（照搬已删插件）

function someHit(hits: Array<{ path: string; value: unknown }>, pred: (v: unknown) => boolean): boolean {
  for (const h of hits) {
    if (pred(h.value)) return true;
  }
  return false;
}

interface Condition {
  path?: unknown;
  op: string;
  value?: unknown;
  flags?: unknown;
}

function oneCondition(node: unknown, c: unknown): boolean {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    throw new Error('where 每项必须是对象');
  }
  const cond = c as Condition;
  if (typeof cond.op !== 'string') throw new Error('where.op 必须是字符串');
  const p = cond.path === undefined || cond.path === '' || cond.path === '$'
    ? []
    : parsePath(typeof cond.path === 'string' ? cond.path : String(cond.path));
  const hits = walk(node, p);
  const op = cond.op;
  const b = cond.value;
  if (op === 'exists') return hits.length > 0;
  if (hits.length === 0) return false;
  if (op === 'eq') return someHit(hits, (a) => deepEqual(a, b));
  if (op === 'ne') return !someHit(hits, (a) => deepEqual(a, b));
  if (op === 'in') {
    if (!Array.isArray(b)) throw new Error('where.op=in 时 value 必须是数组');
    return someHit(hits, (a) => b.some((x) => deepEqual(a, x)));
  }
  if (op === 'contains') {
    return someHit(hits, (a) => {
      if (typeof a === 'string') return typeof b === 'string' && a.indexOf(b) >= 0;
      if (Array.isArray(a)) return a.some((x) => deepEqual(x, b));
      if (isObj(a)) return typeof b === 'string' && !DANGEROUS_KEYS.has(b) && hasOwn(a, b);
      return false;
    });
  }
  if (op === 'startsWith' || op === 'endsWith') {
    return someHit(hits, (a) => {
      if (typeof a !== 'string' || typeof b !== 'string') return false;
      if (op === 'startsWith') return a.indexOf(b) === 0;
      return a.length >= b.length && a.lastIndexOf(b) === a.length - b.length;
    });
  }
  if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
    return someHit(hits, (a) => {
      // 不做隐式类型转换：类型不同或不是数值/字符串，一律判不满足
      if (typeof a !== typeof b) return false;
      if (typeof a !== 'number' && typeof a !== 'string') return false;
      const bb = b as number | string;
      const aa = a as number | string;
      if (op === 'gt') return aa > bb;
      if (op === 'gte') return aa >= bb;
      if (op === 'lt') return aa < bb;
      return aa <= bb;
    });
  }
  if (op === 'match') {
    if (typeof b !== 'string') throw new Error('where.op=match 时 value 必须是正则字符串');
    const flags = typeof cond.flags === 'string' ? cond.flags : '';
    // g / y 会让 test 记住 lastIndex，导致同一正则在不同节点上结果不确定，故拒绝
    if (flags.indexOf('g') >= 0 || flags.indexOf('y') >= 0) {
      throw new Error('flags 不允许 g / y（会引入 lastIndex 状态，结果不确定）');
    }
    const re = new RegExp(b, flags);
    return someHit(hits, (a) => isScalar(a) && re.test(String(a)));
  }
  throw new Error('不支持的 where.op：' + op);
}

function matchWhere(node: unknown, conditions: unknown[]): boolean {
  for (const c of conditions) {
    if (!oneCondition(node, c)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- 字段投影（照搬已删插件 + 承接 display subKey）

/** 只保留这些顶层字段；对数组逐元素投影。危险键不投影。 */
function project(v: unknown, pick: string[] | undefined): unknown {
  if (!pick) return v;
  if (Array.isArray(v)) return v.map((x) => project(x, pick));
  if (isObj(v)) {
    const o: Record<string, unknown> = {};
    for (const k of pick) {
      if (DANGEROUS_KEYS.has(k)) continue;
      if (hasOwn(v, k)) o[k] = v[k];
    }
    return o;
  }
  return v;
}

// ---------------------------------------------------------------- 参数解析与执行

interface ExtractArgs {
  value: unknown;
  path: string;
  where: unknown[];
  pick?: string[];
}

type ParseResult =
  | { ok: true; value: ExtractArgs }
  | { ok: false; error: string };

/** 严格校验参数；value 缺省按「未注入」处理（阶段二由 runner 注入） */
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

  const rp = r['path'];
  if (rp !== undefined && typeof rp !== 'string') {
    return { ok: false, error: 'path 必须是字符串' };
  }
  const path = typeof rp === 'string' ? rp.trim() : '';

  let where: unknown[] = [];
  const rw = r['where'];
  if (rw !== undefined) {
    if (!Array.isArray(rw)) return { ok: false, error: 'where 必须是数组' };
    where = rw;
  }

  let pick: string[] | undefined;
  const rk = r['pick'];
  if (rk !== undefined) {
    if (!Array.isArray(rk) || rk.some((x) => typeof x !== 'string')) {
      return { ok: false, error: 'pick 必须是字符串数组' };
    }
    pick = rk as string[];
  }

  // exactOptionalPropertyTypes: pick 为 undefined 时整个键省略，不能直接传 undefined
  return pick === undefined
    ? { ok: true, value: { value, path, where } }
    : { ok: true, value: { value, path, where, pick } };
}

function fail(reason: string): PrimitiveResult {
  return {
    observation: `json_extract：${reason}。本次没有产出 value，请如实告诉用户，不要编造。`,
    ok: false,
    detail: reason,
  };
}

/** 构造内置算子 json_extract。纯计算，无依赖、无缓存。 */
export function createJsonExtractPrimitive(): SkillPrimitive {
  return {
    name: JSON_EXTRACT_TOOL_NAME,
    definition: JSON_EXTRACT_TOOL,
    idempotent: true,
    execute: async (args: Record<string, unknown>): Promise<PrimitiveResult> => {
      const parsed = parseArgs(args);
      if (!parsed.ok) return fail(parsed.error);
      const args = parsed.value;

      let candidates: Array<{ path: string; value: unknown }>;
      let matched: Array<{ path: string; value: unknown }>;
      try {
        const tokens = parsePath(args.path);
        candidates = walk(args.value, tokens);
        matched = args.where.length === 0
          ? candidates
          : candidates.filter((h) => matchWhere(h.value, args.where));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return fail(reason);
      }

      const items = matched.map((h) => project(h.value, args.pick));
      // value 出参：单命中直接给该值，多命中给数组，零命中给空数组。
      // 这是连线用的纯值，不含 path（path 属于已删插件 query 的 items 形状，
      // 阶段二连线只认 value，故不搬 {path,value} 包装）。
      const outValue: unknown = items.length === 1 ? items[0] : items;
      return {
        observation: `json_extract：从输入 value 命中 ${matched.length} 项，`
          + `返回 ${items.length} 项（纯 value 出参，正文未写入上下文）。`
          + '渲染请交给 display_json_list。',
        ok: true,
        detail: `提取命中 ${matched.length} 项 / 返回 ${items.length} 项`,
        value: outValue,
      };
    },
  };
}

/** 与 BasicPrimitives 注册风格一致，直接导出一个实例亦可 */
export const jsonExtractPrimitive: SkillPrimitive = createJsonExtractPrimitive();
