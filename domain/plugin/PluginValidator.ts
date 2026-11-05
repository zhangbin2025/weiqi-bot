/**
 * 插件代码预检（纯字符串检查，不做语法解析）
 * @module domain/plugin/PluginValidator
 *
 * 定位：这是写入工件前的「快筛」，真正的隔离由 QuickJS 沙箱保证。
 * 这里只挡住明显的越权意图，避免把明显不合规的代码喂给 LLM 反复修复。
 */

import type { ContractCheck, PluginSpec } from '@domain/plugin/types';

/** 浏览器 / 宿主全局访问：沙箱里本就不存在，但提前给出更清楚的报错 */
const BROWSER_GLOBALS =
  /\bfetch\b|\bwindow\b|\bdocument\b|\blocalStorage\b|\bindexedDB\b|\bXMLHttpRequest\b|\bimportScripts\b|\brequire\b|\bpostMessage\b|\bself\b|\bnavigator\b|\bWebSocket\b/;

const HIGH_RISK: ReadonlyArray<{ re: RegExp; reason: string }> = [
  { re: /\beval\s*\(/, reason: '不允许使用 eval()' },
  { re: /\bnew\s+Function\b/, reason: '不允许使用 new Function()' },
  { re: /\bimport\s*\(/, reason: '不允许动态 import()' },
  { re: /\bwhile\s*\(\s*true\s*\)/, reason: '不允许 while(true) 死循环' },
  { re: /\bfor\s*\(\s*;\s*;\s*\)/, reason: '不允许 for(;;) 死循环' },
];

export class PluginValidator {
  validate(code: string, spec: PluginSpec): { ok: boolean; reason?: string } {
    if (typeof code !== 'string' || !code.trim()) {
      return { ok: false, reason: '插件代码为空' };
    }

    const bytes = new TextEncoder().encode(code).length;
    if (bytes > spec.limits.maxCodeBytes) {
      return {
        ok: false,
        reason: `代码 ${bytes} 字节，超过上限 ${spec.limits.maxCodeBytes} 字节`,
      };
    }

    const globalHit = BROWSER_GLOBALS.exec(code);
    if (globalHit) {
      return { ok: false, reason: `不允许访问浏览器/宿主全局：${globalHit[0]}` };
    }

    for (const item of HIGH_RISK) {
      if (item.re.test(code)) {
        return { ok: false, reason: item.reason };
      }
    }

    return { ok: true };
  }
}

/** 按扩展点约定，输出行必须具备的字段 */
function requiredFields(spec: PluginSpec): string[] {
  return spec.pointId === 'ranking.tiebreak' ? ['rank', 'id'] : [];
}

/**
 * 输出契约校验（备用）：只检查结构，不解析代码。
 * - outputIsArray：是否数组
 * - missingFields：缺失的字段名（去重）
 * - entryFound：结构是否足以认为入口产物成立（非空数组且无缺失）
 */
export function validatePluginOutput(output: unknown, spec: PluginSpec): ContractCheck {
  if (!Array.isArray(output)) {
    return { entryFound: false, outputIsArray: false, missingFields: requiredFields(spec) };
  }

  const required = requiredFields(spec);
  const missing = new Set<string>();
  for (const row of output) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      for (const f of required) missing.add(f);
      continue;
    }
    const record = row as Record<string, unknown>;
    for (const f of required) {
      if (!(f in record)) missing.add(f);
    }
    if (required.includes('rank') && typeof record['rank'] !== 'number') {
      missing.add('rank(number)');
    }
  }

  const missingFields = [...missing];
  return { entryFound: output.length > 0 && missingFields.length === 0, outputIsArray: true, missingFields };
}

/** 把 ContractCheck 转成可回喂 LLM 的人话提示 */
export function contractCheckHint(check: ContractCheck): string {
  if (!check.outputIsArray) return '插件入口必须返回一个数组';
  if (check.missingFields.length > 0) {
    return `返回数组缺少字段：${check.missingFields.join('、')}；每一行都要带数值 rank 和原有 id`;
  }
  if (!check.entryFound) return '返回数组为空，请检查入口是否被调用';
  return '输出结构符合契约';
}
