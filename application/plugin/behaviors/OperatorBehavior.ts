/**
 * workflow-operator 扩展点的行为配方（业务模块）
 * @module application/plugin/behaviors/OperatorBehavior
 *
 * 把原先散落在 PluginTools.trial / PluginCatalogService.tryRun / checkCompatibility
 * 里的 workflow-operator 专属分派收敛到这一份声明式配方：
 * exposes[] / smoke[] 契约、call({method,args}) 自检用例、确定性 expect 比对、
 * 观察文案。契约校验本身仍复用 application/plugin/OperatorContract.ts 的既有口径
 * （validateOperatorContract 一行未改），框架层不认识 workflow-operator。
 */

import type { ContractCheck, OperatorArtifactContract } from '@domain/plugin/types';
import { WORKFLOW_OPERATOR_POINT_ID } from '@domain/plugin/types';
import type {
  ExtensionPointBehavior, ExtensionPointTrialCase, ExtensionPointTrialContext,
  TrialCaseBuildResult,
} from '@domain/plugin/ExtensionPointBehavior';
import { validateGenericOutput } from '@domain/plugin/PluginValidator';
import {
  validateOperatorContract, operatorTrialCases, deepEqual,
} from '../OperatorContract';

/** 沙箱契约说明：逐字沿用既有开发指引，不另立解释、不引入新阈值 */
export const OPERATOR_DEV_LINES = [
  '- 除了排名插件，也可以写「工作流算子」（workflow-operator）：注册进宿主算子表的纯计算函数，',
  '  例如单位换算、日期换算、编码解码。写这类插件时 plugin_write 要带 pointId:"workflow-operator"，',
  '  并且同时给 exposes[]（方法白名单）与 smoke[]（自检样例 + 期望结果）。',
  '- 算子源码入口固定为 function call(input)，input 是 { method, args }：',
  '  method 只能取 exposes[].name，args 是参数数组；返回任意可 JSON 序列化的值。',
  '  方法实现建议挂在源码自己的对象上，用白名单查表调用，绝不要用 eval / new Function。',
  '- exposes[] 每项：{ name: 合法方法标识符, description: 一句话说明, params: 参数 JSON Schema }。',
  '  params 会原样进入宿主算子表条目，阶段二 workflow 节点按名引用并照它填参数。',
  '- smoke[] 每项：{ method?(可省略,默认 exposes[0]), args:[一个参数对象], expect: 期望返回值 }。',
  '  宿主逐条跑沙箱并与 expect 逐字段比对，能跑但算错也拒；样例请用确定性输入，',
  '  不要依赖当前时间 / 随机数。',
  '- 写完默认停用，必须用户到「本地插件」人工启用；启用后注册进宿主算子表，阶段二 workflow 节点按名引用。',
  '  源码不进模型上下文、不进页面 JS 环境，只在一次性 QuickJS Worker 里执行。',
].join('\n');

export const OPERATOR_CONTRACT_HINT =
  '算子输出不符合契约：必须返回可 JSON 序列化的值，并与 smoke[].expect 逐字段一致';

/** 只做形状读取，合法性交给 validateOperatorContract 统一判定 */
function contractOfArgs(args: Record<string, unknown>): OperatorArtifactContract | undefined {
  const exposes = args['exposes'];
  const smoke = args['smoke'];
  if (exposes === undefined && smoke === undefined) return undefined;
  return {
    exposes: Array.isArray(exposes) ? exposes as OperatorArtifactContract['exposes'] : [],
    smoke: Array.isArray(smoke) ? smoke as OperatorArtifactContract['smoke'] : [],
  };
}

export const operatorBehavior: ExtensionPointBehavior = {
  pointId: WORKFLOW_OPERATOR_POINT_ID,
  label: '工作流算子（workflow-operator）',
  resultLabel: '自检结果',
  revisionResultLabel: '本版自检结果',
  contractLines: OPERATOR_DEV_LINES,
  supportsApplySelection: false,
  pointIdDescription: '"workflow-operator"（工作流算子）：入口 call(input)，另带 exposes[] 与 smoke[]，默认停用',
  extraParams: {
    exposes: {
      type: 'array',
      description: '算子方法白名单 [{name,description,params}]；写工作流算子时必填',
      items: { type: 'object' },
    },
    smoke: {
      type: 'array',
      description: '算子自检样例 [{method?,args:[参数],expect}]；写工作流算子时必填',
      items: { type: 'object' },
    },
  },

  buildTrialCases(ctx: ExtensionPointTrialContext): TrialCaseBuildResult {
    const bad = validateOperatorContract(ctx.contract);
    if (bad !== undefined) {
      return { ok: false, reason: `workflow-operator 契约不合法：${bad}。请给出 exposes[] 与 smoke[]。` };
    }
    const cases = operatorTrialCases(ctx.contract as OperatorArtifactContract).map((c) => ({
      input: { method: c.method, args: c.args } as unknown,
      label: c.method,
      expect: c.expect,
    }));
    if (cases.length === 0) {
      return { ok: false, reason: 'workflow-operator 资源缺少 smoke[] 自检样例，无法验证' };
    }
    return { ok: true, cases, usedCustomInput: false };
  },

  validateOutput(output: unknown, _input: unknown): ContractCheck {
    return validateGenericOutput(output);
  },

  contractHint(check: ContractCheck): string {
    return `输出不符合契约（${check.missingFields.join('、') || '未知原因'}）：${OPERATOR_CONTRACT_HINT}`;
  },

  formatResult(outputs: readonly unknown[], cases: readonly ExtensionPointTrialCase[]): string {
    const lines = cases.map((c, i) => `- ${c.label}：${JSON.stringify(outputs[i])}`);
    return `自检 ${cases.length} 条全部通过：\n${lines.join('\n')}`;
  },

  trialScopeLabel(_usedCustomInput: boolean): string {
    return '资源声明的自检样例';
  },

  matchesExpect(actual: unknown, expected: unknown): boolean {
    return deepEqual(actual, expected);
  },

  parseContract(args: Record<string, unknown>): unknown {
    return contractOfArgs(args);
  },

  validateContract(contract: unknown): string | undefined {
    return validateOperatorContract(contract);
  },

  artifactContract(ctx: ExtensionPointTrialContext): unknown {
    return ctx.contract;
  },
};
