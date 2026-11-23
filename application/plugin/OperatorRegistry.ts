/**
 * 宿主统一算子表（阶段一地基）
 * @module application/plugin/OperatorRegistry
 *
 * 阶段一只提供「按名执行 value→value」的统一地基：
 * - 内置算子：包装 createBasicPrimitives() 返回的 SkillPrimitive（D 代理保证 json_extract 在其中）。
 * - 插件算子：遍历已启用工件，按 pointId 分派：
 *   - workflow-operator：exposes[] 每项注册为 `<slug>.<method>`；
 *   - ranking：单入口 rank(input)，按资源 id 注册为一个算子（如 `ranking.total-score`）；
 *   - 其它扩展点不进算子表。
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
 * - workflow-operator 契约入口固定 call({method,args})，其中 args 是含一个参数对象的数组
 *   （与 smoke[].args / 插件源码 call() 校验同形）；exposes[] 是方法白名单
 *   （安装前 smoke[] 已试跑通过）。ranking 契约入口是 rank(input)，input 直接是算子 args。
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
import { WORKFLOW_OPERATOR_POINT_ID, RANKING_POINT_ID, RANKING_SPEC } from '@domain/plugin/types';
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
 * 工件算子命名空间（slug）的唯一权威来源是 `catalogRef.resourceId`
 * ——远端资源声明、发布后稳定不变的 id。`artifact.id` 只是本地工件主键
 * （在线安装件是 `plugin:<ts>:<random>` 生成式），绝不拿来当算子命名空间。
 * 无 catalogRef 的 LLM/手工自建件没有远端稳定名，退回完整 artifact.id，不猜名字。
 */
function artifactSlug(artifact: PluginArtifact): string {
  const resourceId = artifact.catalogRef?.resourceId;
  const prefix = `${WORKFLOW_OPERATOR_POINT_ID}.`;
  let slug: string;
  if (resourceId !== undefined && resourceId.startsWith(prefix))
    slug = resourceId.slice(prefix.length);          // 'workflow-operator.lunar' → 'lunar'
  else if (resourceId !== undefined)
    slug = resourceId;                               // ranking 等情况：资源 id 本身即命名空间
  else
    slug = artifact.id;                              // LLM 自建件：完整生成式 id
  return slug;
}

/**
 * 已启用工件 → 若干 OperatorSpec，按 pointId 分派：
 * - workflow-operator：exposes[] 每项注册为 `<slug>.<method>`，沿用既有
 *   call({method,args:[args]}) 输入 + 工件自带 spec（hostApi: [] + DEFAULT_PLUGIN_LIMITS）；
 * - ranking：单入口 rank(input)，input 就是算子 args，spec 用 RANKING_SPEC；算子名取
 *   资源 id 全名（资源 id 已带 `ranking.` 前缀时直接用整串，不重复拼前缀）；
 * - 其它 pointId：不进算子表。
 * 两类 run 复用同一 QuickJS 一次性 Worker 链，失败抛明确 Error（runner 包装结构化失败），
 * 成功取 result.output 作 StepResult.value；纯计算算子一律 idempotent: true。
 */
function pluginArtifactToOperatorSpecs(
  artifact: PluginArtifact,
  runtime: IPluginRuntime,
): OperatorSpec[] {
  const slug = artifactSlug(artifact);

  if (artifact.pointId === RANKING_POINT_ID) {
    // ranking 是单入口 rank(input)：资源 id 本身即算子名（如 `ranking.total-score`），
    // 不带 `ranking.` 前缀的 slug 才补前缀；LLM 自建件得到 `ranking.<artifact.id>`。
    const rankingPrefix = `${RANKING_POINT_ID}.`;
    const name = slug.startsWith(rankingPrefix) ? slug : `${rankingPrefix}${slug}`;
    return [{
      name,
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
  }

  if (artifact.pointId === WORKFLOW_OPERATOR_POINT_ID) {
    const contract = artifact.operatorContract;
    if (contract === undefined || contract.exposes.length === 0) return [];
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

  return []; // 其它扩展点：宿主算子表不认
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
  // 按 pointId 分派在 pluginArtifactToOperatorSpecs 内完成（ranking / workflow-operator 都进表，
  // 其它扩展点返回空集）；这里不再按扩展点设卫兵。
  for (const artifact of active) {
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
