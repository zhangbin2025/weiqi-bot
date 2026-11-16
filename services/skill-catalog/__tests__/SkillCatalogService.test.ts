/**
 * SkillCatalogService / parseSkillRegistry 契约测试
 *
 * 原则：全部通过注入 fetchImpl 打桩，绝不触碰真实网络；
 * 覆盖「内置兜底 / 在线覆盖 / 版本守卫 / 格式与网络降级 / 非法配方拒绝」。
 */

import { describe, it, expect } from 'vitest';
import { BUILTIN_SKILLS } from '@application/skill/BuiltinSkills';
import {
  parseSkillRecipe,
  parseSkillRegistry,
} from '@application/skill/SkillRecipe';
import { SkillCatalogService } from '../SkillCatalogService';

/** 注入的在线源：公网 https，能通过 validateRegistryUrl（不打真实网络） */
const ONLINE_URL = 'https://assets.example.com/skills/registry.json';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function textResponse(body: string, ok = true, status = 200): Response {
  return { ok, status, text: async () => body } as Response;
}

/** 以内置第一条为模板构造一条合法在线配方，按需覆盖字段 */
function recipe(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'event.import-pairing-image',
    version: 1,
    name: '图片对阵表导入赛事',
    summary: '内置摘要',
    triggers: ['对阵表'],
    primitives: ['event_parse_draft', 'event_commit_draft'],
    prompt: '内置提示',
    ...overrides,
  };
}

function registryOf(skills: unknown[]): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: 'weiqi-bot skills',
    description: '测试在线源',
    skills,
  };
}

function fetchReturning(body: unknown): typeof fetch {
  return (async () => jsonResponse(body)) as unknown as typeof fetch;
}

function catalogWith(fetchImpl: typeof fetch): SkillCatalogService {
  return new SkillCatalogService({ fetchImpl, onlineUrl: ONLINE_URL });
}

describe('SkillCatalogService.loadSkills — 内置兜底', () => {
  it('注入的 fetch 抛错（网络失败）时静默返回内置两条', async () => {
    const fetchImpl = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    const skills = await catalogWith(fetchImpl).loadSkills();

    expect(skills.map((s) => s.id)).toEqual([
      'event.import-pairing-image',
      'puzzle.tsumego',
    ]);
    expect(skills[0]?.summary).toBe(BUILTIN_SKILLS[0]?.summary);
    // 返回的是副本，调用方改动不会污染内置常量
    expect(skills).not.toBe(BUILTIN_SKILLS);
  });

  it('HTTP 非 2xx 时回落内置', async () => {
    const fetchImpl = (async () => ({
      ok: false,
      status: 503,
      text: async () => '',
    })) as unknown as typeof fetch;

    const skills = await catalogWith(fetchImpl).loadSkills();
    expect(skills).toEqual(BUILTIN_SKILLS);
  });

  it('在线正文不是合法 JSON → 回落内置', async () => {
    const fetchImpl = (async () => textResponse('<html>not json</html>')) as unknown as typeof fetch;
    const skills = await catalogWith(fetchImpl).loadSkills();
    expect(skills).toEqual(BUILTIN_SKILLS);
  });

  it('在线 JSON 结构不合法（含非法配方）→ 回落内置', async () => {
    const fetchImpl = fetchReturning(registryOf([recipe({ triggers: [] })]));
    const skills = await catalogWith(fetchImpl).loadSkills();
    expect(skills).toEqual(BUILTIN_SKILLS);
  });

  it('在线 URL 不合法（http 明文）→ 回落内置，且不发请求', async () => {
    const called: string[] = [];
    const fetchImpl = (async (url: string) => {
      called.push(url);
      return jsonResponse(registryOf([recipe()]));
    }) as unknown as typeof fetch;
    const service = new SkillCatalogService({
      fetchImpl,
      onlineUrl: 'http://assets.example.com/skills/registry.json',
    });

    const skills = await service.loadSkills();
    expect(skills).toEqual(BUILTIN_SKILLS);
    expect(called).toHaveLength(0); // URL 校验在发请求之前就拒绝了
  });
});

describe('SkillCatalogService.loadSkills — 在线叠加', () => {
  it('在线 version 高于内置 → 覆盖该条，其余内置保留', async () => {
    // 夹具模板 event.import-pairing-image 的内置版本会随功能升级（如图片表格
    // 链路升到 2），这里用内置版本 +1 才真是「高于」，不写死数字。
    const higher = (BUILTIN_SKILLS[0]?.version ?? 0) + 1;
    const online = registryOf([
      recipe({ version: higher, summary: '在线高版本摘要' }),
    ]);
    const skills = await catalogWith(fetchReturning(online)).loadSkills();

    const updated = skills.find((s) => s.id === 'event.import-pairing-image');
    expect(updated?.version).toBe(higher);
    expect(updated?.summary).toBe('在线高版本摘要');
    expect(skills.find((s) => s.id === 'puzzle.tsumego')).toEqual(BUILTIN_SKILLS[1]);
  });

  it('在线同 id 高版本在前、低版本在后 → 低版本不覆盖', async () => {
    const online = registryOf([
      recipe({ version: 3, summary: '高版本' }),
      recipe({ version: 1, summary: '低版本，不应生效' }),
    ]);
    const skills = await catalogWith(fetchReturning(online)).loadSkills();

    const merged = skills.find((s) => s.id === 'event.import-pairing-image');
    expect(merged?.version).toBe(3);
    expect(merged?.summary).toBe('高版本');
  });

  it('在线 version 等于内置 → 按 >= 规则覆盖', async () => {
    const same = BUILTIN_SKILLS[0]?.version ?? 1;
    const online = registryOf([recipe({ version: same, summary: '同版本覆盖' })]);
    const skills = await catalogWith(fetchReturning(online)).loadSkills();
    const merged = skills.find((s) => s.id === 'event.import-pairing-image');
    expect(merged?.summary).toBe('同版本覆盖');
  });

  it('在线低版本（version: 0）被校验拒绝 → 整份清单回落内置', async () => {
    const online = registryOf([recipe({ version: 0, summary: '非法低版本' })]);
    const skills = await catalogWith(fetchReturning(online)).loadSkills();
    expect(skills).toEqual(BUILTIN_SKILLS);
  });

  it('在线独有的新 id 直接加入（新增能力只加一条 JSON）', async () => {
    const online = registryOf([
      recipe({
        id: 'review.joseki',
        name: '定式复盘',
        summary: '复盘定式',
        triggers: ['定式'],
        primitives: ['web_fetch'],
        prompt: '用 web_fetch 查定式资料后复盘。',
      }),
    ]);
    const skills = await catalogWith(fetchReturning(online)).loadSkills();

    expect(skills).toHaveLength(BUILTIN_SKILLS.length + 1);
    expect(skills.map((s) => s.id)).toContain('review.joseki');
    expect(skills[0]).toEqual(BUILTIN_SKILLS[0]);
    expect(skills[1]).toEqual(BUILTIN_SKILLS[1]);
  });
});

describe('parseSkillRegistry 拒绝非法配方', () => {
  it('接受契约 §7.6 形状的完整清单', () => {
    const valid = registryOf([
      recipe({ id: 'a' }),
      recipe({ id: 'b', triggers: ['死活题'], primitives: ['web_fetch', 'navigate_to'] }),
    ]);
    const parsed = parseSkillRegistry(valid);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.registry.skills).toHaveLength(2);
  });

  it('拒绝版本号非正整数 / schemaVersion 不等于 1', () => {
    expect(parseSkillRecipe(recipe({ version: 0 })).ok).toBe(false);
    expect(parseSkillRecipe(recipe({ version: 1.5 })).ok).toBe(false);
    expect(parseSkillRecipe(recipe({ schemaVersion: 2 })).ok).toBe(false);
  });

  it('拒绝空 triggers / 空 primitives / 非法原语名', () => {
    expect(parseSkillRecipe(recipe({ triggers: [] })).ok).toBe(false);
    expect(parseSkillRecipe(recipe({ primitives: [] })).ok).toBe(false);
    expect(parseSkillRecipe(recipe({ primitives: ['Web_Fetch'] })).ok).toBe(false);
    expect(parseSkillRecipe(recipe({ primitives: ['9bad'] })).ok).toBe(false);
  });

  it('拒绝缺少必填字段 / skills 非数组 / 顶层字段缺失', () => {
    expect(parseSkillRecipe(recipe({ summary: '' })).ok).toBe(false);
    expect(parseSkillRegistry({ schemaVersion: 1, name: 'x', description: 'd', skills: 'nope' }).ok).toBe(false);
    expect(parseSkillRegistry({ schemaVersion: 1, name: 'x', skills: [] }).ok).toBe(false);
    expect(parseSkillRegistry(registryOf([recipe({ prompt: 42 })])).ok).toBe(false);
    expect(parseSkillRecipe(null).ok).toBe(false);
  });
});
