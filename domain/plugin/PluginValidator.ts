/**
 * 插件代码预检（纯字符串检查，不做语法解析）
 * @module domain/plugin/PluginValidator
 *
 * 定位：写入工件前的「快筛」，真正隔离由 QuickJS 沙箱保证。
 * 输出结构的正式校验在 domain/ranking/RankingTable.validateRankingOutput，
 * 由统一管线 computeRanking 调用；这里只提供同一校验的轻量包装，便于诊断回喂。
 */

import type { ContractCheck, PluginSpec } from '@domain/plugin/types';
import { RANKING_POINT_ID } from '@domain/plugin/types';
import type { RankingInput } from '@domain/ranking/types';
import { validateRankingOutput } from '@domain/ranking/RankingTable';
import { SAMPLE_RANKING_INPUT } from '@domain/ranking/sampleInput';

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

/**
 * 输出契约校验：委托给统一管线的 validateRankingOutput（同一份约束，不另立解释）。
 * input 省略时用代表性对阵样例，方便诊断/测试单独调用时也能核对选手身份。
 * 注意：新契约输出是 { columns, rows } 对象，不再是数组；outputIsArray 恒为 false。
 */
export function validatePluginOutput(
  output: unknown,
  spec: PluginSpec,
  input: RankingInput = SAMPLE_RANKING_INPUT,
): ContractCheck {
  // ranking 沿用原来的严格结构校验，逐字不动。
  if (spec.pointId === RANKING_POINT_ID) {
    const check = validateRankingOutput(output, input);
    return {
      entryFound: check.ok,
      outputIsArray: false,
      missingFields: check.missingFields,
    };
  }
  // llm-tool 等通用扩展点：输出形状由资源自己声明，宿主只要求「可 JSON 序列化」。
  // runtime.run 已经用 JSON.stringify 取过结果（QuickJsExecutor），这里再对
  // unknown 值做一次纯函数检查，避免调用方绕过 runtime 时把不可序列化的值放过去。
  return validateGenericOutput(output);
}

/** 通用扩展点输出校验：只验可 JSON 序列化，不解读业务语义 */
export function validateGenericOutput(output: unknown): ContractCheck {
  try {
    const json = JSON.stringify(output);
    if (json === undefined) {
      return { entryFound: false, outputIsArray: false, missingFields: ['输出不是可 JSON 序列化的值'] };
    }
    return { entryFound: true, outputIsArray: false, missingFields: [] };
  } catch {
    return { entryFound: false, outputIsArray: false, missingFields: ['输出无法 JSON 序列化（含循环引用或 BigInt）'] };
  }
}

/** 把 ContractCheck 转成可回喂 LLM 的人话提示 */
export function contractCheckHint(check: ContractCheck): string {
  if (check.missingFields.length > 0) {
    // ranking 的详细提示逐字保留（既有诊断文案与测试依赖它）；通用扩展点
    // 的缺失字段来自 validateGenericOutput，用不带排名语义的短提示。
    const generic = check.missingFields.some((f) => f.startsWith('输出'));
    if (generic) return `输出不符合契约（${check.missingFields.join('、')}）`;
    return `排名表不符合契约（${check.missingFields.join('、')}）：必须返回 { columns, rows } 对象，列名为汉字，cells 只能是数值或数值数组`;
  }
  if (!check.entryFound) return '入口未返回合法的 { columns, rows } 对象，请检查 rank 是否被调用';
  return '输出结构符合契约';
}
