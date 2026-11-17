/**
 * 宿主原语注册表 + 从选中技能生成 tools/executors 的小工具。
 * @module application/skill/SkillRegistry
 *
 * 注册表按原语 name 建 Map；buildSkillToolParts 供接线方（E）把命中技能的
 * 原语挂进 ToolKit。缺原语的名字静默跳过（selectSkills 已过滤，这里是第二道保险）。
 */

import type { ModelToolDefinition } from '@application/model/IModelGateway';
import type { ToolOutcome } from '@application/chat/ToolLoop';
import type { SkillPrimitive, SkillRecipe, PrimitiveResult } from '@application/skill/SkillTypes';

/** 按 name 建只读 Map；同名后者覆盖前者，与宿主注册表固定 id 口径一致 */
export function createSkillRegistry(primitives: SkillPrimitive[]): ReadonlyMap<string, SkillPrimitive> {
  const map = new Map<string, SkillPrimitive>();
  for (const p of primitives) map.set(p.name, p);
  return map;
}

/** 接线方所需的一套 tools + executors（E 在 ChatUseCase 里合并进 ToolKit） */
export interface ChatToolKitParts {
  tools: ModelToolDefinition[];
  executors: Record<string, (a: string) => Promise<ToolOutcome>>;
}

/** PrimitiveResult → ToolOutcome：三个必填字段 + 可选的宿主注入链接 */
function toToolOutcome(r: PrimitiveResult): ToolOutcome {
  const out: ToolOutcome = { observation: r.observation, ok: r.ok, detail: r.detail };
  if (r.actionLink) out.actionLink = r.actionLink;
  if (r.preparatory) out.preparatory = true;
  return out;
}

/**
 * 汇总 active 技能引用的原语：definition 去重、executor 按 name 映射。
 * - 去重按原语 name，保留首次出现顺序；
 * - 注册表里查不到的原语名静默跳过。
 */
export function buildSkillToolParts(
  active: readonly SkillRecipe[],
  registry: ReadonlyMap<string, SkillPrimitive>,
): ChatToolKitParts {
  const tools: ModelToolDefinition[] = [];
  const executors: Record<string, (a: string) => Promise<ToolOutcome>> = {};
  const seen = new Set<string>();

  for (const skill of active) {
    for (const name of skill.primitives) {
      if (seen.has(name)) continue;
      const primitive = registry.get(name);
      if (!primitive) continue; // 第二道保险：缺原语静默跳过
      seen.add(name);
      tools.push(primitive.definition);
      executors[name] = async (argsJson: string) => toToolOutcome(await primitive.execute(argsJson));
    }
  }

  return { tools, executors };
}
