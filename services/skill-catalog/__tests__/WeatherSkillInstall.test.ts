/**
 * 天气技能（weiqi-assets weather.wttr v6）安装链路端到端回归。
 *
 * 背景：weather.wttr v6 用宿主原生 storage.get / set / delete 读写偏好。
 * 宿主命名空间若没进共享排除集合，安装器会推导出不存在的
 * workflow-operator.storage 依赖，plan() 报 blocker，整个技能装不上
 * （编译/单测/validate 全绿也挡不住这个运行时故障）。
 *
 * 本用例读 weiqi-assets 仓库里**真实的** skill.json（两仓同级部署），
 * 走完整链路：解析 → 依赖推导 → 安装编排 plan → 写本地技能库 install。
 * 不 stub 配方数据，改了配方就能在这里暴露。
 */
import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { parseSkillRecipe } from '@application/skill/SkillRecipe';
import type { SkillPrimitive, SkillRecipe } from '@application/skill/SkillTypes';
import {
  SkillCatalogService, skillPluginResourceIds, SkillPluginInstaller,
} from '../SkillCatalogService';
import { UserSkillStore } from '@application/skill/dev/UserSkillStore';
import type { PluginCatalogService } from '@services/plugin-catalog/PluginCatalogService';
import type { PluginArtifactService } from '@application/plugin/PluginArtifactService';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const WEATHER_SKILL_JSON = resolve(
  REPO_ROOT, '../weiqi-assets/skills/weather.wttr/skill.json',
);

/** 两仓同级部署时才有这份真实配方；单独 clone bot 仓库（如 CI）则跳过，不造环境红灯。 */
const assetsAvailable = existsSync(WEATHER_SKILL_JSON);

function loadWeatherRecipe(): SkillRecipe {
  const raw: unknown = JSON.parse(readFileSync(WEATHER_SKILL_JSON, 'utf-8'));
  const parsed = parseSkillRecipe(raw);
  if (!parsed.ok) throw new Error(`天气配方解析失败：${parsed.reason}`);
  return parsed.skill;
}

function memLocalStorage() {
  const data = new Map<string, unknown>();
  return {
    initialize: async () => {},
    read: async <T>(key: string) => (data.has(key) ? (data.get(key) as T) : null),
    write: async <T>(key: string, value: T) => { data.set(key, value); },
    delete: async (key: string) => { data.delete(key); },
  };
}

function prim(name: string): SkillPrimitive {
  return {
    name,
    definition: { name, description: name, parameters: { type: 'object' } },
    idempotent: true,
    outputSchema: {},
    kind: 'pure',
    execute: async () => ({ observation: 'ok', ok: true, detail: name }),
  };
}

describe.skipIf(!assetsAvailable)('天气技能 weather.wttr v6 — 真实配方安装链路', () => {
  it('recipe 合法，声明 primitives:[] 且 workflow 引用宿主 storage.*', () => {
    const recipe = loadWeatherRecipe();
    expect(recipe.id).toBe('weather.wttr');
    expect(recipe.version).toBe(9);
    expect(recipe.primitives).toEqual([]);
    const calls = JSON.stringify(recipe.workflow);
    for (const op of ['storage.get', 'storage.set', 'storage.delete']) {
      expect(calls).toContain(op);
    }
  });

  it('storage.* 不产生 workflow-operator.storage 依赖（否则插件源里找不到会拦下安装）', () => {
    const ids = skillPluginResourceIds(loadWeatherRecipe());
    expect(ids).toEqual([]);
    expect(ids).not.toContain('workflow-operator.storage');
  });

  it('SkillPluginInstaller.plan：零依赖 → 零网络请求、零动作、零 blocker', async () => {
    const browseResources = vi.fn(async () => ({ entries: [], failures: [] }));
    const catalog = { browseResources } as unknown as PluginCatalogService;
    const artifacts = { list: async () => [] } as unknown as PluginArtifactService;
    const installer = new SkillPluginInstaller({ catalog, artifacts });

    const plan = await installer.plan(loadWeatherRecipe());
    expect(plan.resourceIds).toEqual([]);
    expect(plan.actions).toEqual([]);
    expect(plan.blockers).toEqual([]);
    expect(browseResources).not.toHaveBeenCalled();

    // apply 同样不该碰插件系统
    const applied = await installer.apply(plan);
    expect(applied.ok).toBe(true);
    expect(applied.failures).toEqual([]);
  });

  it('SkillCatalogService.install：成功写入本地技能库，即刻生效', async () => {
    const users = new UserSkillStore({ localStorage: memLocalStorage() as never });
    const catalog = new SkillCatalogService({
      users,
      primitives: new Map<string, SkillPrimitive>([
        ['run_workflow', prim('run_workflow')],
      ]),
      fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch,
      onlineUrl: 'https://assets.example.com/skills/registry.json',
    });

    const result = await catalog.install(loadWeatherRecipe());
    expect(result).toMatchObject({ ok: true, action: 'installed' });
    const installed = await users.list();
    expect(installed.map((e) => e.recipe.id)).toContain('weather.wttr');
    expect(await catalog.loadSkills()).toHaveLength(1);
  });
});
