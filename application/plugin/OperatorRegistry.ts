/**
 * 宿主统一算子表（阶段一地基）
 * @module application/plugin/OperatorRegistry
 *
 * 阶段一只提供「按名执行 value→value」的统一地基：
 * - 内置算子：包装 createBasicPrimitives() 返回的通用宿主 SkillPrimitive。
 * - 插件算子：遍历已启用工件，按 pointId 查「算子适配注册表」分派；框架不认识任何
 *   具体扩展点，未声明算子适配的扩展点不进算子表。新增扩展点只需在装配根
 *   （createOperatorAdapters）加一条适配声明即可，本文件不用改。
 * - 解析配方 / 拓扑排序 / DAG / 步骤过程块 / 配方迁移 全部留给阶段二 workflow runner；
 *   本文件不解析配方、不做 DAG、不挂模型 tools[]、不进 system 清单，
 *   ChatUseCase / ChatPage / ToolLoop 也都不引用它（阶段二才接线）。
 *
 * 安全边界沿用既有 QuickJS 沙箱，不在此重写：
 * - 插件算子执行复用注入的 IPluginRuntime.run()（QuickJsRuntime 复用 Worker、但每次调用创建独立 QuickJS Runtime / Context），
 *   hostApi 恒为 []（零网络、零时钟、零存储、零 DOM、零定时器），
 *   配额沿用工件自带的 spec.limits（DEFAULT_PLUGIN_LIMITS）。
 * - 插件算子只认「已启用」工件（人工启用闸门），method 只作为 JSON 数据进入
 *   __PLUGIN_INPUT__，绝不拼进代码字符串；源码不进模型上下文。
 * - 各扩展点的入口 / 命名 / 输入形状由各自的适配声明给出（见 behaviors/OperatorAdapters），
 *   框架不写死任何契约入口。
 *
 */

import type {
  IPluginRuntime,
  OperatorSpec,
  PluginArtifact,
  StepResult,
} from '@domain/plugin/types';
import type { SkillPrimitive, PrimitiveResult } from '@application/skill/SkillTypes';
import type { PluginArtifactService } from './PluginArtifactService';
import { createOperatorAdapters, type OperatorAdapterRegistry } from './behaviors/OperatorAdapters';
import { validateSchemaDefinition, validateSchemaValue } from './OperatorSchema';

export interface OperatorRegistryDeps {
  /** 宿主内置原语；接线方传 createBasicPrimitives(webDeps) 的返回值 */
  primitives: readonly SkillPrimitive[];
  /** 工件服务；插件算子从 listActive() 取已启用工件 */
  artifacts: PluginArtifactService;
  /** QuickJS 沙箱运行时（QuickJsRuntime：一次 run = 一次性 Worker） */
  runtime: IPluginRuntime;
  /** 算子适配注册表；由装配根注入，缺省时用默认注册表（测试便利） */
  adapters?: OperatorAdapterRegistry;
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
 * 原生 args 直接传给 primitive；PrimitiveResult.value 是算子的纯 value 出，
 * 缺省按 null（连线只认 value）。displayMarkdown 走既有宿主渲染通道（effects），
 * actionLink 是宿主结构化链接对象，映射成 effects 里的字符串（url），label 不进 value。
 */
function primitiveToOperatorSpec(p: SkillPrimitive): OperatorSpec {
  return {
    name: p.name,
    idempotent: p.idempotent,
    description: p.definition.description,
    inputSchema: p.definition.parameters,
    outputSchema: p.outputSchema,
    kind: p.kind,
    run: async (args: Record<string, unknown>): Promise<StepResult> => {
      const r: PrimitiveResult = await p.execute(args);
      // 没有 value 的失败先走 WorkflowRunner 结构化失败通道，避免 undefined 被归一为
      // null 后误报 outputSchema 错误。若失败仍携带合法 value（如 fetch_batch 部分成功），
      // 保留该结果供下游按每项 ok/detail 自行处理。
      if (!r.ok && r.value === undefined) {
        throw new Error(r.observation || r.detail || `算子 ${p.name} 执行失败`);
      }
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

  for (const spec of map.values()) {
    validateSchemaDefinition(spec.inputSchema, `${spec.name}.inputSchema`);
    if (spec.inputSchema['type'] !== 'object') throw new Error(`${spec.name}.inputSchema 根类型必须是 object`);
    validateSchemaDefinition(spec.outputSchema, `${spec.name}.outputSchema`);
  }

  const adapters = deps.adapters ?? createOperatorAdapters();
  let active: PluginArtifact[] = [];
  try {
    active = await deps.artifacts.listActive();
  } catch {
    active = [];
  }
  for (const artifact of active) {
    const adapter = adapters[artifact.pointId];
    if (!adapter) continue; // 未声明算子适配的扩展点不进算子表（通用规则，不是特判）
    // 存量工件可能来自旧版持久化数据（exposes[].params）。单个旧/损坏工件不能
    // 让整张宿主算子表装配失败；它不会注册，引用时会得到「未注册算子」诊断。
    // 资源作者需按新契约重新发布并重新安装，宿主不提供 legacy 双轨执行。
    let adapted: OperatorSpec[];
    try {
      adapted = adapter.toSpecs({ artifact, runtime: deps.runtime });
    } catch {
      continue;
    }
    for (const op of adapted) {
      try {
        validateSchemaDefinition(op.inputSchema, `${op.name}.inputSchema`);
        if (op.inputSchema['type'] !== 'object') continue;
        validateSchemaDefinition(op.outputSchema, `${op.name}.outputSchema`);
      } catch {
        continue;
      }
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
      const inputError = validateSchemaValue(op.inputSchema, args);
      if (inputError) throw new Error(`算子 ${name} 输入校验失败：${inputError}`);
      const result = await op.run(args);
      const outputError = validateSchemaValue(op.outputSchema, result.value);
      if (outputError) throw new Error(`算子 ${name} 输出校验失败：${outputError}`);
      return result;
    },
  };
}
