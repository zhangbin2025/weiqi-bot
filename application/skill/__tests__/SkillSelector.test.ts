/**
 * 模块 D 单测：选择器 / system 生成 / 注册表 + tools-executors 映射。
 *
 * 全部用最小假注册表与纯内存原语，不触网、不碰 IndexedDB、不依赖真实 web 工具。
 * 覆盖契约 §3 与 §7.5：触发词、附件场景、跨轮确认、缺原语跳过、无命中、大小写、
 * 去重、PrimitiveResult→ToolOutcome 只填三个必填字段。
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
    triggers: over.triggers ?? ['触发'],
    primitives: over.primitives ?? ['p_a'],
    prompt: over.prompt ?? '这是使用提示',
  };
}

/** 由原语名数组建一个只读注册表 */
function registry(names: readonly string[]): ReadonlyMap<string, SkillPrimitive> {
  return createSkillRegistry(names.map((n) => fakePrimitive(n)));
}

describe('selectSkills', () => {
  it('触发词命中（中文直接 includes）', () => {
    const r = recipe({ id: 'x.one', triggers: ['死活题', '做题'], primitives: ['p_a'] });
    const reg = registry(['p_a']);
    expect(selectSkills('我想做一道死活题', false, [r], reg)).toEqual([r]);
    expect(selectSkills('陪我做题吧', false, [r], reg)).toEqual([r]);
  });

  it('触发词大小写不敏感', () => {
    const r = recipe({ id: 'x.en', triggers: ['GoRule', 'TSUMEGO'], primitives: ['p_a'] });
    const reg = registry(['p_a']);
    expect(selectSkills('please explain gorule', false, [r], reg)).toEqual([r]);
    expect(selectSkills('TSUMEGO 是什么', false, [r], reg)).toEqual([r]);
    expect(selectSkills('tSuMeGo 练习', false, [r], reg)).toEqual([r]);
  });

  it('附件场景命中 event.import* 技能，不再要求 query 含关键词', () => {
    const r = recipe({
      id: 'event.import-pairing-image',
      triggers: ['完全不相干的词'],
      primitives: ['p_a'],
    });
    const reg = registry(['p_a']);
    // 上传图片时的文字常常只是「这个」「帮我看看」；确认轮的「好的」同理。
    expect(selectSkills('帮我把这张对阵看一下', true, [r], reg)).toEqual([r]);
    expect(selectSkills('这个', true, [r], reg)).toEqual([r]);
    expect(selectSkills('好的，确认', true, [r], reg)).toEqual([r]);
  });

  it('附件场景但技能 id 不是 event.import* 前缀，或无附件 → 不命中', () => {
    const reg = registry(['p_a']);
    const notEvent = recipe({ id: 'puzzle.tsumego', triggers: ['无关'], primitives: ['p_a'] });
    expect(selectSkills('导入对阵', true, [notEvent], reg)).toEqual([]);
    const eventSkill = recipe({
      id: 'event.import-pairing-image',
      triggers: ['无关'],
      primitives: ['p_a'],
    });
    expect(selectSkills('你好呀', false, [eventSkill], reg)).toEqual([]);
    expect(selectSkills('确认', false, [eventSkill], reg)).toEqual([]);
  });

  it('引用缺原语的技能整条跳过（在线资源可领先宿主）', () => {
    const ok = recipe({ id: 'x.ok', triggers: ['命中'], primitives: ['p_a'] });
    const missing = recipe({ id: 'x.missing', triggers: ['命中'], primitives: ['p_a', 'p_missing'] });
    const reg = registry(['p_a']); // 注册表中没有 p_missing
    expect(selectSkills('命中', false, [ok, missing], reg)).toEqual([ok]);
  });

  it('primitives 为空也视为缺原语 → 跳过', () => {
    const empty = recipe({ id: 'x.empty', triggers: ['命中'], primitives: [] });
    expect(selectSkills('命中', false, [empty], registry(['p_a']))).toEqual([]);
  });

  it('无命中返回空数组', () => {
    const r = recipe({ triggers: ['死活题'], primitives: ['p_a'] });
    expect(selectSkills('今天天气不错', false, [r], registry(['p_a']))).toEqual([]);
    expect(selectSkills('随便聊聊', false, [], registry(['p_a']))).toEqual([]);
  });

  it('保持 recipes 原始顺序，多条命中都返回', () => {
    const a = recipe({ id: 'x.a', triggers: ['甲'], primitives: ['p_a'] });
    const b = recipe({ id: 'x.b', triggers: ['乙'], primitives: ['p_b'] });
    const reg = registry(['p_a', 'p_b']);
    expect(selectSkills('甲和乙都要', false, [a, b], reg)).toEqual([a, b]);
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
      triggers: ['月历'],
      primitives: ['p_a'],
      requiredCapabilities,
      prompt: '生成月历表格',
    };
  }

  it('缺任一依赖方法 → 整条跳过（与缺原语同一层）', () => {
    const skill = withCaps(['monthCalendar', 'solarTerms']);
    const reg = registry(['p_a']);
    expect(selectSkills('看月历', false, [skill], reg, ['monthCalendar'])).toEqual([]);
    expect(selectSkills('看月历', false, [skill], reg, [])).toEqual([]);
    // ReadonlySet 形态也要能用
    expect(selectSkills('看月历', false, [skill], reg, new Set(['monthCalendar']))).toEqual([]);
  });

  it('依赖全部齐备 → 正常激活', () => {
    const skill = withCaps(['monthCalendar']);
    const reg = registry(['p_a']);
    expect(selectSkills('看月历', false, [skill], reg, ['monthCalendar'])).toEqual([skill]);
    expect(selectSkills('看月历', false, [skill], reg, new Set(['monthCalendar', 'festivals'])))
      .toEqual([skill]);
  });

  it('未注入能力清单（第 5 参省略）→ 有依赖的技能不激活，老配方不受影响', () => {
    const old = recipe({ id: 'x.old', triggers: ['月历'], primitives: ['p_a'] });
    const skill = withCaps(['monthCalendar']);
    const reg = registry(['p_a']);
    // 老配方无该字段：4 参数调用逐字兼容
    expect(selectSkills('看月历', false, [old], reg)).toEqual([old]);
    // 有依赖但没清单：宁可不激活，也不给半套能力
    expect(selectSkills('看月历', false, [old, skill], reg)).toEqual([old]);
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
    expect(out).toContain('技能只是提示，实际能力以本轮工具为准；写操作必须先给预览、结束本轮回复，等用户下一条消息明确确认后再提交。');
    // base 与技能块之间恰好一个空行
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
    // 其余可选字段一律不设置
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
