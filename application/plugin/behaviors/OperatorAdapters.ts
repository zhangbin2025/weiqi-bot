/**
 * 算子适配注册表（业务装配模块）
 * @module application/plugin/behaviors/OperatorAdapters
 *
 * 这是「算子表怎么按扩展点分派」的**数据定义处**，与 createExtensionPointBehaviors()
 * 同一范式：按 pointId 索引的一张注册表，框架（OperatorRegistry）只读它、只按
 * artifact.pointId 查表，不认识任何具体扩展点、不再写 `if (pointId === ...)`。
 * 新增扩展点若要把已启用工件编进宿主算子表，只需在装配根（createOperatorAdapters）
 * 加一条适配声明；框架一行不用改。
 *
 * 各扩展点的入口函数名、算子命名、输入形状、用的 spec 全部由各自的适配声明给出，
 * 不是框架常量。注册表里出现具体 pointId 名字属于数据定义、不是硬编码分支。
 * 安全边界（hostApi: []、配额、一次性 QuickJS Worker、method 只作 JSON 数据）沿用
 * 既有工件与 spec，本模块不引入任何新阈值 / 经验常数。
 */

import type {
  IPluginRuntime,
  OperatorSpec,
  PluginArtifact,
  PluginRunResult,
  PluginSpec,
  StepResult,
} from '@domain/plugin/types';
import {
  WORKFLOW_OPERATOR_POINT_ID, RANKING_POINT_ID, RANKING_SPEC,
} from '@domain/plugin/types';

export interface OperatorAdapterContext {
  artifact: PluginArtifact;
  runtime: IPluginRuntime;
}

export interface OperatorAdapter {
  /** 把一件已启用工件翻译成若干带完整 name 的 OperatorSpec */
  toSpecs(ctx: OperatorAdapterContext): OperatorSpec[];
}

export type OperatorAdapterRegistry = Readonly<Record<string, OperatorAdapter>>;

/**
 * 工件算子命名空间（slug）的权威来源，按优先级：
 * 1. `artifact.slug` —— LLM/手工自建件由 plugin_write 显式给的稳定短名（发布时
 *    映射成 `workflow-operator.<slug>` resourceId）；有它就能让技能配方的
 *    workflow.steps[].call 稳定引用自己开发的算子，不依赖生成式 artifact.id。
 * 2. `artifact.catalogRef?.resourceId` —— 在线安装件的远端资源 id（发布后稳定不变），
 *    有 `workflow-operator.` 前缀则去掉，否则用整串。
 * 3. 都没有时才回退完整 `artifact.id`（生成式，仅展示/兜底，不该被配方引用）。
 * 两个 adapter 共用，框架不认识具体扩展点。
 */
export function artifactSlug(artifact: PluginArtifact): string {
  if (artifact.slug !== undefined && artifact.slug.trim() !== '') return artifact.slug;
  const resourceId = artifact.catalogRef?.resourceId;
  const prefix = `${WORKFLOW_OPERATOR_POINT_ID}.`;
  if (resourceId !== undefined && resourceId.startsWith(prefix)) {
    return resourceId.slice(prefix.length); // 'workflow-operator.calc' → 'calc'
  }
  if (resourceId !== undefined) return resourceId; // 资源 id 本身即命名空间
  return artifact.id; // LLM / 手工自建件（未给 slug）：完整生成式 id
}

/** 单入口适配：算子名取资源 id 全名（不带 `ranking.` 前缀才补），沙箱 input 直接是算子 args。 */
const rankingAdapter: OperatorAdapter = {
  toSpecs({ artifact, runtime }): OperatorSpec[] {
    const slug = artifactSlug(artifact);
    const rankingPrefix = `${RANKING_POINT_ID}.`;
    const name = slug.startsWith(rankingPrefix) ? slug : `${rankingPrefix}${slug}`;
    return [{
      name,
      description: artifact.intent || `排名算子 ${name}`,
      inputSchema: { type: 'object' },
      outputSchema: {},
      kind: 'pure',
      idempotent: true,
      run: async (args: Record<string, unknown>): Promise<StepResult> => {
        const result: PluginRunResult = await runtime.run(artifact.code, args, RANKING_SPEC);
        if (!result.ok) {
          const reason = result.error?.message ?? result.phase;
          throw new Error(`算子 ${name} 执行失败（${result.phase}）：${reason}`);
        }
        return { value: result.output ?? null };
      },
    }];
  },
};

/** 多方法适配：exposes[] 每项注册 `<slug>.<method>`，输入包 `{method, args:[args]}`，spec 用工件自带。 */
const workflowOperatorAdapter: OperatorAdapter = {
  toSpecs({ artifact, runtime }): OperatorSpec[] {
    const slug = artifactSlug(artifact);
    const contract = artifact.operatorContract;
    if (contract === undefined || contract.exposes.length === 0) return [];
    const spec: PluginSpec = artifact.spec; // 沿用工件落库时的 spec（hostApi: [] + DEFAULT_PLUGIN_LIMITS）
    return contract.exposes.map((exposure) => {
      const method = exposure.name;
      return {
        name: `${slug}.${method}`,
        description: exposure.description,
        inputSchema: exposure.inputSchema,
        outputSchema: exposure.outputSchema,
        kind: exposure.kind,
        idempotent: exposure.idempotent,
        run: async (args: Record<string, unknown>): Promise<StepResult> => {
          // 插件 call(input) 契约：input.args 是「含一个参数对象的数组」
          // （见资源 plugin.json 的 smoke[].args 与插件源码的 call() 校验）。
          // OperatorRegistry.run 收到的是单个参数对象，这里按既有契约包一层。
          const result: PluginRunResult = await runtime.run(
            artifact.code,
            { method, args: [args] },
            spec,
          );
          if (!result.ok) {
            const reason = result.error?.message ?? result.phase;
            throw new Error(`算子 ${slug}.${method} 执行失败（${result.phase}）：${reason}`);
          }
          return { value: result.output ?? null };
        },
      };
    });
  },
};

/** 返回一份新的按 pointId 索引的算子适配注册表（装配根唯一需要维护的数据定义处） */
export function createOperatorAdapters(): OperatorAdapterRegistry {
  return {
    [RANKING_POINT_ID]: rankingAdapter,
    [WORKFLOW_OPERATOR_POINT_ID]: workflowOperatorAdapter,
  };
}
