/**
 * Host-native deterministic data operators for Workflow.
 *
 * These operators are part of the trusted host runtime, not installable plugin
 * artifacts. They intentionally expose only JSON-compatible inputs/outputs.
 */
import type { OperatorSpec } from '@domain/plugin/types';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const OBJECT_SCHEMA = { type: 'object' } as const;

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} 必须是对象`);
  return value as Record<string, unknown>;
}
function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} 必须是数组`);
  return value;
}
function safeKey(key: string): string {
  if (!key || FORBIDDEN_KEYS.has(key)) throw new Error(`不允许访问对象保留属性：${key}`);
  return key;
}
function pathParts(path: unknown): string[] {
  if (typeof path !== 'string' || !path.trim()) throw new Error('path 必须是非空字符串');
  const parts = path.replace(/\[(?:"([^"]+)"|'([^']+)'|(\d+))\]/g, '.$1$2$3').split('.').filter(Boolean);
  return parts.map(safeKey);
}
function getPath(value: unknown, path: unknown): unknown {
  let current = value;
  for (const part of pathParts(path)) {
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
function setPath(value: unknown, path: unknown, next: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(value)) as unknown;
  const parts = pathParts(path);
  let current: unknown = copy;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (current === null || typeof current !== 'object' || Array.isArray(current)) throw new Error('path 中间节点不是对象');
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, key) || record[key] === null || typeof record[key] !== 'object') {
      Object.defineProperty(record, key, { value: {}, enumerable: true, configurable: true, writable: true });
    }
    current = record[key];
  }
  if (current === null || typeof current !== 'object' || Array.isArray(current)) throw new Error('path 父节点不是对象');
  Object.defineProperty(current, parts[parts.length - 1], { value: next, enumerable: true, configurable: true, writable: true });
  return copy;
}
function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}
function matches(item: unknown, where: unknown): boolean {
  if (where === undefined || where === null) return true;
  const conditions = object(where, 'where');
  for (const [path, expected] of Object.entries(conditions)) {
    const actual = getPath(item, path);
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      const op = object(expected, 'where 条件');
      if ('stringEq' in op) { if (String(actual) !== String(op.stringEq)) return false; }
      else if ('ne' in op) { if (actual === op.ne) return false; }
      else if ('in' in op) { if (!array(op.in, 'in').includes(actual)) return false; }
      else if ('notIn' in op) { if (array(op.notIn, 'notIn').includes(actual)) return false; }
      else if (actual !== expected) return false;
    } else if (actual !== expected) return false;
  }
  return true;
}
function jsonCall(method: string, raw: Record<string, unknown>): unknown {
  const a = raw;
  switch (method) {
    case 'parse':
      if (typeof a.text !== 'string') throw new Error('text 必须是 JSON 字符串');
      return JSON.parse(a.text);
    case 'stringify':
      return JSON.stringify(a.value, null, typeof a.space === 'number' ? Math.min(10, Math.max(0, a.space)) : undefined);
    case 'get': return getPath(a.value, a.path);
    case 'set': return setPath(a.value, a.path, a.nextValue);
    case 'select': {
      const rows = array(a.items, 'items').filter((x) => matches(x, a.where));
      if (!Array.isArray(a.pick) || a.pick.length === 0) return rows;
      return rows.map((x) => {
        const out: Record<string, unknown> = {};
        for (const p of a.pick as unknown[]) {
          if (typeof p !== 'string') throw new Error('pick 每项必须是路径字符串');
          const key = safeKey(p);
          Object.defineProperty(out, key, { value: getPath(x, p), enumerable: true, configurable: true, writable: true });
        }
        return out;
      });
    }
    case 'pluck': return array(a.items, 'items').filter((x) => matches(x, a.where)).map((x) => getPath(x, a.path));
    case 'concat': {
      if (Array.isArray(a.arrays)) return (a.arrays as unknown[]).flatMap((x) => array(x, 'arrays 每项'));
      if (Array.isArray(a.left) && Array.isArray(a.right)) return [...a.left, ...a.right];
      throw new Error('arrays 必须是数组');
    }
    case 'unique': {
      const seen = new Set<string>();
      return array(a.items, 'items').filter((x) => {
        const key = a.key ? getPath(x, a.key) : x;
        const id = JSON.stringify(key);
        if (seen.has(id)) return false;
        seen.add(id); return true;
      });
    }
    case 'append': return [...array(a.items, 'items'), a.value];
    case 'groupCount': {
      const counts = new Map<string, number>();
      for (const item of array(a.items, 'items')) {
        const key = String(getPath(item, a.path));
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts].map(([key, count]) => ({ key, count })).sort((x, y) => y.count - x.count || compare(x.key, y.key));
    }
    case 'sortBy': {
      const direction = a.order === 'desc' ? -1 : 1;
      return array(a.items, 'items').slice().sort((x, y) => direction * compare(getPath(x, a.path), getPath(y, a.path)));
    }
    case 'take': {
      const count = a.count;
      if (!Number.isInteger(count) || (count as number) < 0 || (count as number) > 100) throw new Error('count 需为 0 到 100 的整数');
      return array(a.items, 'items').slice(0, count as number);
    }
    case 'isEmpty': {
      const v = a.value;
      return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) ||
        (typeof v === 'object' && v !== null && Object.keys(v).length === 0);
    }
    case 'assert':
      if (('equals' in a && a.value !== a.equals) || ('notEquals' in a && a.value === a.notEquals)) {
        throw new Error(typeof a.message === 'string' ? a.message : '断言失败');
      }
      return true;
    case 'flatten': {
      const stack = array(a.items, 'items').slice().reverse();
      const out: unknown[] = [];
      while (stack.length) {
        const value = stack.pop();
        if (Array.isArray(value)) for (let i = value.length - 1; i >= 0; i--) stack.push(value[i]);
        else out.push(value);
      }
      return out;
    }
    case 'toString':
      if (a.value === null || a.value === undefined || typeof a.value === 'object') throw new Error('value 必须是非空原始值');
      return String(a.value);
    default: throw new Error(`不支持的 JSON action：${method}`);
  }
}
function regexCall(method: string, a: Record<string, unknown>): unknown {
  if (typeof a.text !== 'string' || typeof a.pattern !== 'string') throw new Error('text/pattern 必须是字符串');
  if (a.pattern.length > 256 || a.text.length > 100_000) throw new Error('正则 pattern 最长 256 字符，text 最长 100000 字符');
  // Host regex runs outside the QuickJS quota boundary. Reject common nested-quantifier
  // and repeated-alternation forms that can trigger catastrophic backtracking.
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(a.pattern) || /\([^)]*\|[^)]*\)[+*{]/.test(a.pattern)) {
    throw new Error('正则包含高风险嵌套重复结构，已拒绝执行');
  }
  const flags = a.flags === undefined ? (method === 'extract' || method === 'replace' ? 'g' : '') : a.flags;
  if (typeof flags !== 'string' || /[^dgimsuvy]/.test(flags) || flags.includes('y')) throw new Error('flags 无效或不支持 sticky 标志 y');
  if (method === 'match') {
    if (flags.includes('g')) throw new Error('match 的 flags 不允许 g');
    const hit = new RegExp(a.pattern, flags).exec(a.text);
    return hit ? { matched: true, value: hit[0], index: hit.index, groups: hit.slice(1) } :
      { matched: false, value: null, index: -1, groups: [] };
  }
  if (method === 'extract') {
    const globalFlags = flags.includes('g') ? flags : flags + 'g';
    const group = a.group === undefined ? 0 : a.group;
    const limit = a.limit === undefined ? 0 : a.limit;
    if (!Number.isInteger(group) || (group as number) < 0 || !Number.isInteger(limit) || (limit as number) < 0) throw new Error('group/limit 必须是非负整数');
    const re = new RegExp(a.pattern, globalFlags), out: unknown[] = [], seen = new Set<string>();
    let hit: RegExpExecArray | null;
    while ((hit = re.exec(a.text)) !== null) {
      const value = hit[group as number] ?? '';
      if (a.unique !== true || !seen.has(String(value))) {
        seen.add(String(value));
        out.push(a.withIndex === true ? { value, index: hit.index } : value);
      }
      if (out.length >= 10_000) throw new Error('regex.extract 命中数量超过 10000 项');
      if ((limit as number) > 0 && out.length >= (limit as number)) break;
      if (hit[0] === '') {
        if (re.lastIndex >= a.text.length) break;
        const cp = a.text.codePointAt(re.lastIndex) ?? 0;
        re.lastIndex += cp > 0xffff ? 2 : 1;
      }
    }
    return out;
  }
  if (method === 'replace') {
    if (typeof a.replacement !== 'string') throw new Error('replacement 必须是字符串');
    return a.text.replace(new RegExp(a.pattern, flags), a.replacement);
  }
  throw new Error(`不支持的 regex action：${method}`);
}
function operator(name: string, description: string, run: (args: Record<string, unknown>) => unknown): OperatorSpec {
  return {
    name, description, kind: 'pure', idempotent: true,
    inputSchema: OBJECT_SCHEMA, outputSchema: {},
    run: async (args) => ({ value: run(args) }),
  };
}

/** Names are stable Workflow DSL contracts: json.<action> and regex.<action>. */
export function createHostWorkflowOperators(): OperatorSpec[] {
  const jsonMethods = ['parse', 'stringify', 'get', 'set', 'select', 'pluck', 'concat', 'unique', 'append', 'groupCount', 'sortBy', 'take', 'isEmpty', 'assert', 'flatten', 'toString'];
  const regexMethods = ['match', 'extract', 'replace'];
  return [
    ...jsonMethods.map((method) => operator(`json.${method}`, `宿主 JSON 算子：${method}`, (args) => jsonCall(method, args))),
    ...regexMethods.map((method) => operator(`regex.${method}`, `宿主正则算子：${method}`, (args) => regexCall(method, args))),
  ];
}
