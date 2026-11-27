/**
 * Host-native pure data operators for Workflow.
 *
 * JSON and RegExp are deterministic computation over Workflow values. They do not
 * need plugin installation, a QuickJS Worker, or access to host capabilities.
 * The operators are registered by name (json.* / regex.*) but are not model tools:
 * only Workflow nodes can invoke them unless a skill explicitly lists one as a tool.
 */

import type { SkillPrimitive, PrimitiveResult } from '@application/skill/SkillTypes';

const MAX_JSON_TEXT_LENGTH = 5 * 1024 * 1024;
const MAX_OUTPUT_NODES = 100_000;
const MAX_OUTPUT_DEPTH = 128;
const MAX_ARRAY_ITEMS = 10_000;
const MAX_REGEX_TEXT_LENGTH = 100_000;
const MAX_REGEX_PATTERN_LENGTH = 512;
const MAX_REGEX_MATCHES = 1_000;
const MAX_REGEX_REPLACEMENT_LENGTH = 10_000;

type JsonPathToken = string | number;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} 必须是数组`);
  if (value.length > MAX_ARRAY_ITEMS) throw new Error(`${name} 超过单次算子上限 ${MAX_ARRAY_ITEMS}`);
  return value;
}

function safeKey(key: string): string {
  if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
    throw new Error('路径包含保留属性名');
  }
  return key;
}

function pathTokens(path: unknown): JsonPathToken[] {
  if (typeof path !== 'string' || !path.trim()) throw new Error('path 必须是非空字符串');
  let source = path.trim();
  if (source === '$') return [];
  if (source.startsWith('$')) source = source.slice(1).replace(/^\./, '');

  const tokens: JsonPathToken[] = [];
  let part = '';
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    if (char === '.') {
      if (part) { tokens.push(safeKey(part)); part = ''; }
      continue;
    }
    if (char === '[') {
      if (part) { tokens.push(safeKey(part)); part = ''; }
      const end = source.indexOf(']', i + 1);
      if (end < 0) throw new Error('path 缺少 ]');
      const raw = source.slice(i + 1, end).trim();
      if (/^\d+$/.test(raw)) tokens.push(Number(raw));
      else if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
        tokens.push(safeKey(raw.slice(1, -1)));
      } else throw new Error('path 下标必须是整数或引号键名');
      i = end;
      continue;
    }
    part += char;
  }
  if (part) tokens.push(safeKey(part));
  if (tokens.length === 0) throw new Error('path 无效');
  return tokens;
}

function getPath(value: unknown, path: unknown): unknown {
  const tokens = pathTokens(path);
  let current: unknown = value;
  for (const token of tokens) {
    if (current === null || current === undefined
      || !Object.prototype.hasOwnProperty.call(Object(current), token)) {
      throw new Error(`path 不存在：${String(path)}`);
    }
    current = (current as Record<string | number, unknown>)[token];
  }
  if (current === undefined) throw new Error(`path 结果为 undefined：${String(path)}`);
  return current;
}

function cloneJson(value: unknown): unknown {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('value 不是可序列化 JSON');
  if (encoded.length > MAX_JSON_TEXT_LENGTH) throw new Error('value 超过 JSON 算子输入上限');
  return JSON.parse(encoded) as unknown;
}

function defineOwn(target: Record<string, unknown> | unknown[], key: JsonPathToken, value: unknown): void {
  if (typeof key === 'string') safeKey(key);
  Object.defineProperty(target, key, {
    value, enumerable: true, configurable: true, writable: true,
  });
}

function setPath(root: unknown, path: unknown, value: unknown): unknown {
  const tokens = pathTokens(path);
  if (tokens.length === 0) throw new Error('不能设置根路径');
  if (root === null || typeof root !== 'object') throw new Error('value 必须是对象或数组');
  let current = root as Record<string | number, unknown> | unknown[];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const key = tokens[i]!;
    const nextKey = tokens[i + 1]!;
    const existing = current[key];
    if (existing === null || typeof existing !== 'object') {
      defineOwn(current, key, typeof nextKey === 'number' ? [] : {});
    }
    const next = current[key];
    if (next === null || typeof next !== 'object') throw new Error('path 中间节点不可写');
    current = next as Record<string | number, unknown> | unknown[];
  }
  defineOwn(current, tokens[tokens.length - 1]!, value);
  return root;
}

function matches(item: unknown, where: unknown): boolean {
  if (!isRecord(where)) return true;
  for (const [path, expected] of Object.entries(where)) {
    let actual: unknown;
    try { actual = getPath(item, path); } catch { return false; }
    if (isRecord(expected) && Object.prototype.hasOwnProperty.call(expected, 'notIn')) {
      if (!Array.isArray(expected['notIn']) || expected['notIn'].includes(actual)) return false;
    } else if (isRecord(expected) && Object.prototype.hasOwnProperty.call(expected, 'stringEq')) {
      if (String(actual) !== String(expected['stringEq'])) return false;
    } else if (isRecord(expected) && Object.prototype.hasOwnProperty.call(expected, 'in')) {
      if (!Array.isArray(expected['in']) || !expected['in'].includes(actual)) return false;
    } else if (isRecord(expected) && Object.prototype.hasOwnProperty.call(expected, 'ne')) {
      if (actual === expected['ne']) return false;
    } else if (actual !== expected) return false;
  }
  return true;
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function identityOf(value: unknown): string {
  if (value !== null && typeof value === 'object') return `object:${JSON.stringify(value)}`;
  return `${typeof value}:${String(value)}`;
}

function runJson(action: string, args: Record<string, unknown>): unknown {
  switch (action) {
    case 'parse': {
      if (typeof args['text'] !== 'string') throw new Error('text 必须是字符串');
      if (args['text'].length > MAX_JSON_TEXT_LENGTH) throw new Error('JSON 文本超过长度上限');
      return JSON.parse(args['text']) as unknown;
    }
    case 'stringify': {
      const encoded = JSON.stringify(args['value']);
      if (encoded === undefined) throw new Error('value 不是可序列化 JSON');
      if (encoded.length > MAX_JSON_TEXT_LENGTH) throw new Error('序列化结果超过长度上限');
      return encoded;
    }
    case 'get': {
      try { return getPath(args['value'], args['path']); }
      catch (error) {
        if (Object.prototype.hasOwnProperty.call(args, 'default')) return args['default'];
        throw error;
      }
    }
    case 'toString': {
      const value = args['value'];
      if (value === null || value === undefined || typeof value === 'object') {
        throw new Error('value 必须是字符串、数字或布尔值');
      }
      return String(value);
    }
    case 'set': {
      const copy = cloneJson(args['value']);
      return setPath(copy, args['path'], args['nextValue']);
    }
    case 'select': {
      const items = requireArray(args['items'], 'items');
      const rows = items.filter((item) => matches(item, args['where']));
      if (args['pick'] === undefined || (Array.isArray(args['pick']) && args['pick'].length === 0)) return rows;
      if (!Array.isArray(args['pick'])) throw new Error('pick 必须是路径字符串数组');
      return rows.map((item) => {
        const output: Record<string, unknown> = {};
        for (const field of args['pick'] as unknown[]) {
          if (typeof field !== 'string') throw new Error('pick 每项必须是路径字符串');
          const key = safeKey(field);
          defineOwn(output, key, getPath(item, field));
        }
        return output;
      });
    }
    case 'pluck': {
      const items = requireArray(args['items'], 'items');
      return items.filter((item) => matches(item, args['where'])).map((item) => getPath(item, args['path']));
    }
    case 'concat': {
      if (args['arrays'] === undefined && Array.isArray(args['left']) && Array.isArray(args['right'])) {
        const left = requireArray(args['left'], 'left');
        const right = requireArray(args['right'], 'right');
        if (left.length + right.length > MAX_ARRAY_ITEMS) throw new Error('合并结果超过数组上限');
        return left.concat(right);
      }
      const arrays = requireArray(args['arrays'], 'arrays');
      const joined: unknown[] = [];
      for (const item of arrays) {
        const next = requireArray(item, 'arrays 每项');
        if (joined.length + next.length > MAX_ARRAY_ITEMS) throw new Error('合并结果超过数组上限');
        joined.push(...next);
      }
      return joined;
    }
    case 'unique': {
      const items = requireArray(args['items'], 'items');
      const seen = new Set<string>();
      const output: unknown[] = [];
      for (const item of items) {
        const key = args['key'] ? getPath(item, args['key']) : item;
        const identity = identityOf(key);
        if (!seen.has(identity)) { seen.add(identity); output.push(item); }
      }
      return output;
    }
    case 'append': {
      const items = requireArray(args['items'], 'items');
      if (items.length >= MAX_ARRAY_ITEMS) throw new Error('追加结果超过数组上限');
      return [...items, args['value']];
    }
    case 'groupCount': {
      const items = requireArray(args['items'], 'items');
      if (typeof args['path'] !== 'string') throw new Error('path 必须是字符串');
      const counts = new Map<string, number>();
      for (const item of items) {
        const key = String(getPath(item, args['path']));
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => (b.count - a.count) || compareValues(a.key, b.key));
    }
    case 'sortBy': {
      const items = requireArray(args['items'], 'items');
      if (typeof args['path'] !== 'string') throw new Error('path 必须是字符串');
      const direction = args['order'] === 'desc' ? -1 : 1;
      return items.slice().sort((a, b) => direction * compareValues(getPath(a, args['path']), getPath(b, args['path'])));
    }
    case 'isEmpty': {
      const value = args['value'];
      return value === null || value === undefined || value === ''
        || (Array.isArray(value) && value.length === 0)
        || (isRecord(value) && Object.keys(value).length === 0);
    }
    case 'assert': {
      const value = args['value'];
      const message = typeof args['message'] === 'string' ? args['message'] : '断言失败';
      if (Object.prototype.hasOwnProperty.call(args, 'equals') && value !== args['equals']) throw new Error(message);
      if (Object.prototype.hasOwnProperty.call(args, 'notEquals') && value === args['notEquals']) throw new Error(message);
      return true;
    }
    case 'flatten': {
      const items = requireArray(args['items'], 'items');
      const stack: unknown[] = [...items].reverse();
      const flattened: unknown[] = [];
      let visited = 0;
      while (stack.length > 0) {
        visited += 1;
        if (visited > MAX_OUTPUT_NODES) throw new Error('flatten 节点数超过上限');
        const next = stack.pop();
        if (Array.isArray(next)) {
          for (let i = next.length - 1; i >= 0; i -= 1) stack.push(next[i]);
        } else flattened.push(next);
      }
      return flattened;
    }
    case 'take': {
      const items = requireArray(args['items'], 'items');
      const count = args['count'];
      if (!Number.isInteger(count) || (count as number) < 0 || (count as number) > 100) {
        throw new Error('count 需为 0 到 100 的整数');
      }
      return items.slice(0, count as number);
    }
    default:
      throw new Error(`不支持的 JSON action：${action}`);
  }
}

function assertRegexInput(args: Record<string, unknown>): { text: string; pattern: string; flags: string } {
  const text = args['text'];
  const pattern = args['pattern'];
  const flags = args['flags'] === undefined ? '' : args['flags'];
  if (typeof text !== 'string' || typeof pattern !== 'string' || typeof flags !== 'string') {
    throw new Error('text、pattern、flags 必须是字符串');
  }
  if (text.length > MAX_REGEX_TEXT_LENGTH) throw new Error('正则输入文本超过长度上限');
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) throw new Error('正则 pattern 超过长度上限');
  return { text, pattern, flags };
}

/**
 * Native RegExp runs synchronously on the host thread. Reject common exponential
 * backtracking shapes and cap both pattern and input sizes before construction.
 */
function makeRegex(pattern: string, flags: string): RegExp {
  if (flags.includes('y')) throw new Error('不支持 sticky 标志 y');
  const quantifiedGroup = /\((?:\\.|[^\\()])*(?:[*+?]|\{\d+(?:,\d*)?\})(?:\\.|[^\\()])*\)(?:[*+?]|\{\d+(?:,\d*)?\})/;
  const ambiguousRepeatedGroup = /\((?:\\.|[^\\()])*\|(?:\\.|[^\\()])*\)(?:[*+?]|\{\d+(?:,\d*)?\})/;
  const adjacentQuantifiedAtoms = /(?:\\?.)(?:[*+?]|\{\d+(?:,\d*)?\})(?:\\?.)(?:[*+?]|\{\d+(?:,\d*)?\})/;
  const repeatedWildcards = /\.\*.*\.\*|\.\+.*\.\+/;
  if (quantifiedGroup.test(pattern) || ambiguousRepeatedGroup.test(pattern)
    || adjacentQuantifiedAtoms.test(pattern) || repeatedWildcards.test(pattern)) {
    throw new Error('正则包含可能导致灾难性回溯的重复分组，已拒绝执行');
  }
  return new RegExp(pattern, flags);
}

function runRegex(action: string, args: Record<string, unknown>): unknown {
  const { text, pattern, flags } = assertRegexInput(args);
  if (action === 'match') {
    if (flags.includes('g') || flags.includes('y')) throw new Error('match 的 flags 不允许 g/y');
    const hit = makeRegex(pattern, flags).exec(text);
    if (!hit) return { matched: false, value: null, index: -1, groups: [] };
    return {
      matched: true,
      value: hit[0],
      index: hit.index,
      groups: hit.slice(1).map((value) => value ?? null),
    };
  }
  if (action === 'extract') {
    let extractFlags = flags || 'g';
    if (!extractFlags.includes('g')) extractFlags += 'g';
    const group = args['group'] === undefined ? 0 : args['group'];
    const limit = args['limit'] === undefined ? 0 : args['limit'];
    if (!Number.isInteger(group) || (group as number) < 0) throw new Error('group 必须是非负整数');
    if (!Number.isInteger(limit) || (limit as number) < 0) throw new Error('limit 必须是非负整数');
    const unique = args['unique'] === true;
    const withIndex = args['withIndex'] === true;
    const extractor = makeRegex(pattern, extractFlags);
    const results: unknown[] = [];
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = extractor.exec(text)) !== null) {
      const value = match[group as number] ?? '';
      const identity = String(value);
      if (!unique || !seen.has(identity)) {
        seen.add(identity);
        results.push(withIndex ? { value, index: match.index } : value);
      }
      if (results.length >= MAX_REGEX_MATCHES || (limit as number) > 0 && results.length >= (limit as number)) break;
      if (match[0] === '') {
        if (extractor.lastIndex >= text.length) break;
        const point = text.codePointAt(extractor.lastIndex);
        extractor.lastIndex += point !== undefined && point > 0xffff ? 2 : 1;
      }
    }
    return results;
  }
  if (action === 'replace') {
    const replacement = args['replacement'];
    if (typeof replacement !== 'string') throw new Error('replacement 必须是字符串');
    if (replacement.length > MAX_REGEX_REPLACEMENT_LENGTH) throw new Error('replacement 超过长度上限');
    const replaceFlags = args['flags'] === undefined ? 'g' : flags;
    const output = text.replace(makeRegex(pattern, replaceFlags), replacement);
    if (output.length > MAX_JSON_TEXT_LENGTH) throw new Error('正则替换结果超过长度上限');
    return output;
  }
  throw new Error(`不支持的 regex action：${action}`);
}

function assertOutputBudget(value: unknown): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  let textUnits = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_OUTPUT_NODES) throw new Error('算子输出节点数超过上限');
    if (current.depth > MAX_OUTPUT_DEPTH) throw new Error('算子输出嵌套深度超过上限');
    if (typeof current.value === 'string') {
      textUnits += current.value.length;
      if (textUnits > MAX_JSON_TEXT_LENGTH) throw new Error('算子输出累计文本超过长度上限');
    }
    if (Array.isArray(current.value)) {
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 });
    } else if (isRecord(current.value)) {
      for (const [key, child] of Object.entries(current.value)) {
        textUnits += key.length;
        if (textUnits > MAX_JSON_TEXT_LENGTH) throw new Error('算子输出累计文本超过长度上限');
        stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
}

function createDataPrimitive(
  name: string,
  description: string,
  execute: (args: Record<string, unknown>) => unknown,
): SkillPrimitive {
  return {
    name,
    definition: {
      name,
      description,
      parameters: { type: 'object', additionalProperties: true },
    },
    idempotent: true,
    outputSchema: {},
    kind: 'pure',
    execute: async (args): Promise<PrimitiveResult> => {
      const value = execute(args);
      assertOutputBudget(value);
      return { observation: `${name} 完成`, ok: true, detail: `${name} 完成`, value };
    },
  };
}

/** JSON / regex host Workflow operators. They are deliberately pure and have no hostApi. */
export function createWorkflowDataPrimitives(): SkillPrimitive[] {
  const jsonActions = [
    'parse', 'stringify', 'get', 'set', 'select', 'pluck', 'concat', 'unique',
    'append', 'groupCount', 'sortBy', 'take', 'isEmpty', 'assert', 'flatten', 'toString',
  ];
  const regexActions = ['match', 'extract', 'replace'];
  const jsonDescriptions: Record<string, string> = {
    parse: '解析 JSON 字符串并返回原生 JSON 值。',
    stringify: '将原生 JSON 值序列化为字符串。',
    get: '按安全属性路径读取值；path 不存在时可返回 default。',
    set: '复制 JSON 值并按安全属性路径设置 nextValue。',
    select: '按 where 条件筛选数组，并可用 pick 投影字段。',
    pluck: '按 where 条件筛选数组并提取指定 path。',
    concat: '按顺序合并 arrays，或合并 left 与 right。',
    unique: '按完整值或指定 key 路径稳定去重。',
    append: '复制 items 数组并追加 value。',
    groupCount: '按 path 分组计数，按数量降序、键升序输出。',
    sortBy: '按 path 对 items 排序；order=desc 时降序。',
    take: '取 items 前 count 项，count 限制为 0 到 100。',
    isEmpty: '判断值是否为空。',
    assert: '断言 value 与 equals 不同或与 notEquals 相同则失败。',
    flatten: '迭代展开嵌套数组，保持原有元素顺序。',
    toString: '将字符串、数字或布尔值转换为字符串。',
  };
  const regexDescriptions: Record<string, string> = {
    match: '执行一次正则匹配，返回 matched、value、index 与捕获组。',
    extract: '提取所有正则匹配，可指定 group、limit、unique 与 withIndex。',
    replace: '按正则替换文本，默认全局替换。',
  };
  return [
    ...jsonActions.map((action) => createDataPrimitive(`json.${action}`, jsonDescriptions[action]!, (args) => runJson(action, args))),
    ...regexActions.map((action) => createDataPrimitive(`regex.${action}`, regexDescriptions[action]!, (args) => runRegex(action, args))),
  ];
}
