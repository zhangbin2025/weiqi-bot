/**
 * llm-tool 资源契约（宿主侧共享定义与纯校验）
 * @module application/plugin/LlmToolContract
 *
 * 一条 llm-tool 工件除了 call({method,args}) 的源码，还必须带一份声明：
 *   exposes[] —— 方法白名单 + 说明 + 参数 JSON Schema（模型侧工具声明的来源）
 *   smoke[]   —— 安装/写入前的确定性自检样例（结果与 expect 逐字段相等才落库）
 *
 * 两条链路共用这一份规则：
 *   - PluginCatalogService：从 weiqi-assets 安装（origin: manual + catalogRef）
 *   - PluginTools.plugin_write：模型在开发角色里自建（origin: llm）
 * 同一套校验、同一套试算输入、同一套比对，避免两处规则漂移。
 *
 * 数值口径：不引入任何阈值/经验常数。样例条数由资源自己声明，宿主不设上限；
 * 输出体积由 DEFAULT_PLUGIN_LIMITS.maxOutputBytes 约束。
 */

import type { LlmToolArtifactContract } from '@domain/plugin/types';

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** 契约形状快筛：返回第一条人话错误，合法返回 undefined */
export function validateLlmToolContract(contract: unknown): string | undefined {
  if (typeof contract !== 'object' || contract === null || Array.isArray(contract)) {
    return 'llm-tool 契约必须是对象（exposes[] + smoke[]）';
  }
  const { exposes, smoke } = contract as Partial<LlmToolArtifactContract>;
  if (!Array.isArray(exposes) || exposes.length === 0) return 'llm-tool 资源缺少 exposes[] 方法白名单';
  const names = new Set<string>();
  for (const e of exposes) {
    if (!e || typeof e.name !== 'string' || !IDENTIFIER.test(e.name)) {
      return `exposes[].name 不是合法方法标识符：${String(e?.name)}`;
    }
    if (names.has(e.name)) return `exposes[] 方法名重复：${e.name}`;
    names.add(e.name);
    if (typeof e.description !== 'string' || !e.description.trim()) {
      return `exposes[].description 为空：${e.name}`;
    }
    if (typeof e.params !== 'object' || e.params === null || Array.isArray(e.params)) {
      return `exposes[].params 不是对象：${e.name}`;
    }
  }
  if (!Array.isArray(smoke) || smoke.length === 0) return 'llm-tool 资源缺少 smoke[] 自检样例';
  for (const s of smoke) {
    if (!s || !Array.isArray(s.args) || s.args.length !== 1) {
      return 'smoke[].args 必须是含一个参数对象的数组';
    }
    if (s.expect === undefined) return 'smoke[].expect 缺失';
    if (s.method !== undefined && (typeof s.method !== 'string' || !names.has(s.method))) {
      return `smoke[].method 不在 exposes[] 白名单里：${String(s.method)}`;
    }
  }
  return undefined;
}

/** 资源声明转成试算输入；method 省略时回落 exposes[0].name */
export interface LlmToolTrialCase {
  method: string;
  args: unknown[];
  expect: unknown;
}

export function llmToolTrialCases(contract: LlmToolArtifactContract): LlmToolTrialCase[] {
  const first = contract.exposes[0]!.name;
  return contract.smoke.map((s) => ({
    method: s.method ?? first,
    args: s.args,
    expect: s.expect,
  }));
}

/** 纯 JSON 值逐字段相等（ArrayBuffer/Date 之类不会出现，沙箱只出 JSON） */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a as Record<string, unknown>).sort();
    const kb = Object.keys(b as Record<string, unknown>).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) => deepEqual(
      (a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k],
    ));
  }
  return false;
}

/** 契约是否相等（纯 JSON 结构），用于 catalog 判断「只改了 manifest」 */
export function contractsEqual(
  a: LlmToolArtifactContract | undefined,
  b: LlmToolArtifactContract | undefined,
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return deepEqual(a, b);
}
