/**
 * 宿主统一算子表（阶段一地基）
 * @module application/plugin/OperatorRegistry
 *
 * 阶段一只提供「按名执行 value→value」的统一地基：
 * - 内置算子：包装 createBasicPrimitives() 返回的 SkillPrimitive（D 代理保证 json_extract 在其中）。
 * - 插件算子：遍历已启用 workflow-operator 工件，exposes[] 每项注册为 `<slug>.<method>`。
 * - 解析配方 / 拓扑排序 / DAG / 步骤过程块 / 配方迁移 全部留给阶段二 workflow runner；
 *   本文件不解析配方、不做 DAG、不挂模型 tools[]、不进 system 清单，
 *   ChatUseCase / ChatPage / ToolLoop 也都不引用它（阶段二才接线）。
 *
 * 安全边界沿用既有 QuickJS 沙箱，不在此重写：
 * - 插件算子执行复用注入的 IPluginRuntime.run()（QuickJsRuntime 就是「一次性 Worker」实现），
 *   hostApi 恒为 []（零网络、零时钟、零存储、零 DOM、零定时器），
 *   配额沿用工件自带的 spec.limits（DEFAULT_PLUGIN_LIMITS）。
 * - 插件算子只认「已启用」工件（人工启用闸门），method 只作为 JSON 数据进入
 *   __PLUGIN_INPUT__，绝不拼进代码字符串；源码不进模型上下文。
 * - 契约入口固定 call({method,args})，其中 args 是含一个参数对象的数组
 *   （与 smoke[].args / 插件源码 call() 校验同形）；exposes[] 是方法白名单
 *   （安装前 smoke[] 已试跑通过）。
 *
 * 不引入任何新阈值 / 经验常数：idempotent 缺省 true 是明说的业务约定
 * （纯计算算子默认幂等，non-idempotent 需显式声明），不是拟合数值。
 */

import type {
  IPluginRuntime,
  OperatorSpec,
  PluginArtifact,
  PluginRunResult,
  StepResult,
  PluginSpec,
} from '@domain/plugin/types';
import { WORKFLOW_OPERATOR_POINT_ID } from '@domain/plugin/types';
import type { SkillPrimitive, PrimitiveResult } from '@application/skill/SkillTypes';
import type { PluginArtifactService } from './PluginArtifactService';

export interface OperatorRegistryDeps {
  /** 宿主内置原语；接线方传 createBasicPrimitives(webDeps) 的返回值 */
  primitives: readonly SkillPrimitive[];
  /** 工件服务；插件算子从 listActive() 取已启用工件 */
  artifacts: PluginArtifactService;
  /** QuickJS 沙箱运行时（QuickJsRuntime：一次 run = 一次性 Worker） */
  runtime: IPluginRuntime;
}

export interface OperatorRegistry {
  /** 只读算子表：name → OperatorSpec。重复名后者覆盖前者 */
  specs: ReadonlyMap<string, OperatorSpec>;
  /** 按名查；不存在返回 undefined */
  get(name: string): OperatorSpec | undefined;
  /** 按名执行 value→value；名字不存在时抛明确错误 */
  run(name: string, args: Record<string, unknown>): Promise<StepResult>;
}

/**
 * 内置原语 → OperatorSpec。
 * args 经 JSON.stringify 走既有 execute(argsJson) 签名；PrimitiveResult.value 是算子的纯 value 出，
 * 缺省按 null（连线只认 value）。displayMarkdown 走既有宿主渲染通道（effects），
 * actionLink 是宿主结构化链接对象，映射成 effects 里的字符串（url），label 不进 value。
 */
function primitiveToOperatorSpec(p: SkillPrimitive): OperatorSpec {
  return {
    name: p.name,
    // 纯计算算子默认幂等；non-idempotent 需原语显式声明（D 代理给 SkillPrimitive 补的可选字段）
    idempotent: p.idempotent ?? true,
    run: async (args: Record<string, unknown>): Promise<StepResult> => {
      const r: PrimitiveResult = await p.execute(JSON.stringify(args));
      const effects: NonNullable<StepResult['effects']> = [];
      if (r.displayMarkdown) effects.push({ displayMarkdown: r.displayMarkdown });
      if (r.actionLink) effects.push({ actionLink: r.actionLink.url });
      return {
        value: r.value ?? null,
        ...(effects.length > 0 ? { effects } : {}),
      };
    },
  };
}

/**
 * 已启用 workflow-operator 工件 → 若干 OperatorSpec。
 * 算子名 = `<slug>.<exposes[].name>`；slug 取工件 id 去掉 `workflow-operator.` 前缀
 * （老工件 id 是 `plugin:<ts>:<random>` 形状时直接用完整 id，写清来源，不猜名字）。
 * 每个 spec 的 run 复用既有 QuickJS 执行链：call({method,args}) 输入 + 工件自带 spec
 * （hostApi: [] 由 spec 保证）+ 一次性 Worker，返回值的 output 作为 StepResult.value。
 */
function pluginArtifactToOperatorSpecs(
  artifact: PluginArtifact,
  runtime: IPluginRuntime,
): OperatorSpec[] {
  const contract = artifact.operatorContract;
  if (contract === undefined || contract.exposes.length === 0) return [];
  const prefix = `${WORKFLOW_OPERATOR_POINT_ID}.`;
  const slug = artifact.id.startsWith(prefix)
    ? artifact.id.slice(prefix.length)
    : artifact.id; // 老工件/LLM 自建工件：id 没有扩展点前缀，直接用完整 id 作 slug
  const spec: PluginSpec = artifact.spec; // 沿用工件落库时的 spec（hostApi: [] + DEFAULT_PLUGIN_LIMITS）
  return contract.exposes.map((exposure) => {
    const method = exposure.name;
    return {
      name: `${slug}.${method}`,
      // 纯计算算子默认幂等；契约未标 non-idempotent 前一律 true（明说的业务约定，非拟合数值）
      idempotent: true,
      run: async (args: Record<string, unknown>): Promise<StepResult> => {
        // 插件 call(input) 契约：input.args 是「含一个参数对象的数组」
        // （见 plugin.json 的 smoke[].args 与 lunar/index.js 的 call() 校验）。
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
}

/**
 * 建一张宿主统一算子表（阶段一地基）。
 * 先注册内置算子（createBasicPrimitives），再注册插件算子；重复名后者覆盖前者，
 * 与既有 createSkillRegistry 的「按 name 建 Map、同名后者覆盖前者」口径一致。
 * 插件工件读取失败按空集降级（装配期离线/存储不可用不该拖垮整张表）。
 */
export async function createOperatorRegistry(deps: OperatorRegistryDeps): Promise<OperatorRegistry> {
  const map = new Map<string, OperatorSpec>();
  for (const p of deps.primitives) {
    map.set(p.name, primitiveToOperatorSpec(p));
  }

  let active: PluginArtifact[] = [];
  try {
    active = await deps.artifacts.listActive();
  } catch {
    active = [];
  }
  for (const artifact of active) {
    if (artifact.pointId !== WORKFLOW_OPERATOR_POINT_ID) continue;
    for (const op of pluginArtifactToOperatorSpecs(artifact, deps.runtime)) {
      map.set(op.name, op);
    }
  }

  const specs: ReadonlyMap<string, OperatorSpec> = map;
  return {
    specs,
    get: (name: string): OperatorSpec | undefined => specs.get(name),
    run: async (name: string, args: Record<string, unknown>): Promise<StepResult> => {
      const op = specs.get(name);
      if (op === undefined) throw new Error(`未注册的算子：${name}`);
      return op.run(args);
    },
  };
}
