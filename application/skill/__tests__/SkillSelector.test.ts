/**
 * 模块 D 单测：选择器 / system 生成 / 注册表 + tools-executors 映射。
 *
 * 全部用最小假注册表与纯内存原语，不触网、不碰 IndexedDB、不依赖真实 web 工具。
 * 触发词匹配已删除：selectSkills 现在只按 LLM 路由给出的 id 做激活前硬门槛筛选。
 * 覆盖：路由 id 命中 / 未知 id 丢弃 / 附件场景 / 缺原语 / 缺能力库 / 去重 /
 * PrimitiveResult→ToolOutcome 只填三个必填字段。
 */

import { describe, it, expect } from 'vitest';
import type { ModelToolDefinition } from '@application/model/IModelGateway';
import type { SkillPrimitive, SkillRecipe, PrimitiveResult } from '@application/skill/SkillTypes';
import { selectSkills, hasAllCapabilities } from '../SkillSelector';
import { buildSkillSystemPrompt } from '../SkillSystemPrompt';
import { createSkillRegistry, buildSkillToolParts } from '../SkillRegistry';

function def(name: string): ModelToolDefinition {
  return { name, description: `fake ${name}`, parameters: { type: 'object', properties: {} } };
}

/** 最小假原语：execute 返回可预期的 PrimitiveResult，便于断言映射 */
function fakePrimitive(name: string, result?: Partial<PrimitiveResult>): SkillPrimitive {
  return {
    name,
    definition: def(name),
    execute: async (argsJson): Promise<PrimitiveResult> => ({
      observation: result?.observation ?? `obs:${name}:${argsJson}`,
      ok: result?.ok ?? true,
      detail: result?.detail ?? `detail:${name}`,
    }),
  };
}

/** 最小假配方，字段可由测试按需覆盖 */
function recipe(over: Partial<SkillRecipe> = {}): SkillRecipe {
  return {
    schemaVersion: 1,
    id: over.id ?? 'test.skill',
    version: over.version ?? 1,
    name: over.name ?? '测试技能',
    summary: over.summary ?? '一句话摘要',
    primitives: over.primitives ?? ['p_a'],
    prompt: over.prompt ?? '这是使用提示',
  };
}

/** 由原语名数组建一个只读注册表 */
function registry(names: readonly string[]): ReadonlyMap<string, SkillPrimitive> {
  return createSkillRegistry(names.map((n) => fakePrimitive(n)));
}

describe('selectSkills（按 LLM 路由 id + 硬门槛）', () => {
  it('路由给出 id → 激活；与用户原话长什么样无关', () => {
    const r = recipe({ id: 'x.one', primitives: ['p_a'] });
    const reg = registry(['p_a']);
    // 「获取最后一个提交」零词汇重叠也能命中：路由只看意图，不看词面
    expect(selectSkills(['x.one'], false, [r], reg)).toEqual([r]);
    expect(selectSkills(['x.one'], false, [r], reg)).toEqual([r]);
  });

  it('路由返回空数组 → 无命中（本轮只挂基础 web 工具）', () => {
    const r = recipe({ primitives: ['p_a'] });
    expect(selectSkills([], false, [r], registry(['p_a']))).toEqual([]);
    expect(selectSkills([], false, [], registry(['p_a']))).toEqual([]);
  });

  it('路由幻觉出目录外的 id → 丢弃，不激活任何技能', () => {
    const r = recipe({ id: 'x.one', primitives: ['p_a'] });
    expect(selectSkills(['ghost.skill', 'x.one.typo'], false, [r], registry(['p_a']))).toEqual([]);
  });

  it('附件场景命中 event.import* 技能，不要求路由给出该 id', () => {
    const r = recipe({ id: 'event.import-pairing-image', primitives: ['p_a'] });
    const reg = registry(['p_a']);
    // 上传图片时文字常只是「这个」「帮我看看」；确认轮「好的」同理。
    expect(selectSkills([], true, [r], reg)).toEqual([r]);
    expect(selectSkills(['x.other'], true, [r], reg)).toEqual([r]);
  });

  it('附件场景但 id 不是 event.import* 前缀，或无附件 → 不命中', () => {
    const reg = registry(['p_a']);
    const notEvent = recipe({ id: 'puzzle.tsumego', primitives: ['p_a'] });
    expect(selectSkills([], true, [notEvent], reg)).toEqual([]);
    const eventSkill = recipe({ id: 'event.import-pairing-image', primitives: ['p_a'] });
    expect(selectSkills([], false, [eventSkill], reg)).toEqual([]);
  });

  it('引用缺原语的技能整条跳过（在线资源可领先宿主）', () => {
    const ok = recipe({ id: 'x.ok', primitives: ['p_a'] });
    const missing = recipe({ id: 'x.missing', primitives: ['p_a', 'p_missing'] });
    const reg = registry(['p_a']);
    expect(selectSkills(['x.ok', 'x.missing'], false, [ok, missing], reg)).toEqual([ok]);
  });

  it('primitives 为空也视为缺原语 → 跳过', () => {
    const empty = recipe({ id: 'x.empty', primitives: [] });
    expect(selectSkills(['x.empty'], false, [empty], registry(['p_a']))).toEqual([]);
  });

  it('保持 recipes 原始顺序，多条命中都返回；重复 id 不重复激活', () => {
    const a = recipe({ id: 'x.a', primitives: ['p_a'] });
    const b = recipe({ id: 'x.b', primitives: ['p_b'] });
    const reg = registry(['p_a', 'p_b']);
    expect(selectSkills(['x.b', 'x.a', 'x.b'], false, [a, b], reg)).toEqual([a, b]);
  });
});

describe('requiredCapabilities（激活前硬门槛）', () => {
  /** recipe() 不透传可选字段，这里显式补上 */
  function withCaps(requiredCapabilities: string[]): SkillRecipe {
    return {
      schemaVersion: 1,
      id: 'x.calendar',
      version: 1,
      name: '月历',
      summary: '需要 monthCalendar 能力',
      primitives: ['p_a'],
      requiredCapabilities,
      prompt: '生成月历表格',
    };
  }

  it('缺任一依赖方法 → 整条跳过（与缺原语同一层）', () => {
    const skill = withCaps(['monthCalendar', 'solarTerms']);
    const reg = registry(['p_a']);
    expect(selectSkills(['x.calendar'], false, [skill], reg, ['monthCalendar'])).toEqual([]);
    expect(selectSkills(['x.calendar'], false, [skill], reg, [])).toEqual([]);
    expect(selectSkills(['x.calendar'], false, [skill], reg, new Set(['monthCalendar']))).toEqual([]);
  });

  it('依赖全部齐备 → 正常激活', () => {
    const skill = withCaps(['monthCalendar']);
    const reg = registry(['p_a']);
    expect(selectSkills(['x.calendar'], false, [skill], reg, ['monthCalendar'])).toEqual([skill]);
    expect(selectSkills(['x.calendar'], false, [skill], reg, new Set(['monthCalendar', 'festivals'])))
      .toEqual([skill]);
  });

  it('未注入能力清单（第 5 参省略）→ 有依赖的技能不激活，老配方不受影响', () => {
    const old = recipe({ id: 'x.old', primitives: ['p_a'] });
    const skill = withCaps(['monthCalendar']);
    const reg = registry(['p_a']);
    expect(selectSkills(['x.old'], false, [old], reg)).toEqual([old]);
    expect(selectSkills(['x.old', 'x.calendar'], false, [old, skill], reg)).toEqual([old]);
  });

  it('hasAllCapabilities：缺省字段恒真，空数组恒真，重复方法名不影响', () => {
    expect(hasAllCapabilities(recipe())).toBe(true);
    expect(hasAllCapabilities(withCaps([]))).toBe(true);
    expect(hasAllCapabilities(withCaps(['monthCalendar']), ['monthCalendar', 'monthCalendar']))
      .toBe(true);
    expect(hasAllCapabilities(withCaps(['monthCalendar']), new Set())).toBe(false);
  });
});

describe('buildSkillSystemPrompt', () => {
  const base = '基础系统提示';

  it('active 为空时原样返回 base（零额外 token）', () => {
    expect(buildSkillSystemPrompt(base, [])).toBe(base);
    expect(buildSkillSystemPrompt(base, [])).not.toContain('本轮可用技能');
  });

  it('非空时追加技能块 + 固定尾句，且 base 保持在前', () => {
    const a = recipe({ summary: '技能甲摘要', prompt: '甲提示' });
    const b = recipe({ summary: '技能乙摘要', prompt: '乙提示' });
    const out = buildSkillSystemPrompt(base, [a, b]);
    expect(out.startsWith(`${base}\n\n`)).toBe(true);
    expect(out).toContain('本轮可用技能：');
    expect(out).toContain('- 名称：技能甲摘要\n  使用提示：甲提示');
    expect(out).toContain('- 名称：技能乙摘要\n  使用提示：乙提示');
    expect(out).toContain('技能只是提示，实际能力以本轮工具为准；改动业务库 / 外部状态的写操作（如导入赛事）必须先给预览、结束本轮回复，等用户下一条消息明确确认后再提交；');
    // 2026-11-19：本地偏好保存不需要二次确认（点链接那条用户消息本身即确认）
    expect(out).toContain('那条消息本身就是确认');
    expect(out).toContain(`${base}\n\n本轮可用技能：`);
  });
});

describe('createSkillRegistry + buildSkillToolParts', () => {
  it('createSkillRegistry 按 name 建只读 Map', () => {
    const reg = createSkillRegistry([fakePrimitive('p_a'), fakePrimitive('p_b')]);
    expect(reg.size).toBe(2);
    expect(reg.get('p_a')?.name).toBe('p_a');
    expect(reg.get('p_b')?.definition.name).toBe('p_b');
    expect(reg.get('nope')).toBeUndefined();
  });

  it('tools 按原语 name 去重（同一原语被多条技能引用只出现一次）', () => {
    const reg = registry(['p_a', 'p_b']);
    const s1 = recipe({ id: 'x.1', primitives: ['p_a', 'p_b'] });
    const s2 = recipe({ id: 'x.2', primitives: ['p_b', 'p_a'] });
    const { tools, executors } = buildSkillToolParts([s1, s2], reg);
    expect(tools.map((t) => t.name)).toEqual(['p_a', 'p_b']);
    expect(Object.keys(executors).sort()).toEqual(['p_a', 'p_b']);
  });

  it('缺原语名静默跳过，不产生 tools/executors', () => {
    const reg = registry(['p_a']);
    const s = recipe({ id: 'x.1', primitives: ['p_a', 'ghost'] });
    const { tools, executors } = buildSkillToolParts([s], reg);
    expect(tools.map((t) => t.name)).toEqual(['p_a']);
    expect(Object.keys(executors)).toEqual(['p_a']);
  });

  it('executor 把 PrimitiveResult 映射成只含三个必填字段的 ToolOutcome', async () => {
    const p = fakePrimitive('p_a', { observation: 'OBS', ok: false, detail: 'DET' });
    const reg = createSkillRegistry([p]);
    const s = recipe({ id: 'x.1', primitives: ['p_a'] });
    const { executors } = buildSkillToolParts([s], reg);
    const outcome = await executors['p_a']!('{"x":1}');
    expect(outcome).toEqual({ observation: 'OBS', ok: false, detail: 'DET' });
    expect('repairable' in outcome).toBe(false);
    expect('preparatory' in outcome).toBe(false);
    expect('parts' in outcome).toBe(false);
    expect('attachment' in outcome).toBe(false);
    expect('code' in outcome).toBe(false);
  });

  it('executor 透传 argsJson 给原语 execute', async () => {
    const reg = registry(['p_a']);
    const s = recipe({ id: 'x.1', primitives: ['p_a'] });
    const { executors } = buildSkillToolParts([s], reg);
    const outcome = await executors['p_a']!('PAYLOAD');
    expect(outcome.observation).toBe('obs:p_a:PAYLOAD');
  });

  it('active 为空 → tools / executors 都为空', () => {
    const { tools, executors } = buildSkillToolParts([], registry(['p_a']));
    expect(tools).toEqual([]);
    expect(executors).toEqual({});
  });
});
