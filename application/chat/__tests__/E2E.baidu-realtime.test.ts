/**
 * 端到端回归：「内置正则算子」+「百度热搜」workflow 技能。
 *
 * 2026-11-25 改版：正则能力从 weiqi-assets 的 workflow-operator.regex_extract
 * 插件下沉为宿主内置算子（createBasicPrimitives → OperatorRegistry），
 * 「百度热搜」配方不再依赖任何插件，也不需要 plugin_write / plugin_toggle
 * 那道人工启用闸门。本回归据此重写：
 *
 *   真 createBasicPrimitives（含 3 个内置正则算子）
 *   → 真 createOperatorRegistry（内置算子自动注册；插件工件库为空）
 *   → 真 skill_write（纯声明 3 步 workflow DAG 落 UserSkillStore）
 *   → 真 buildWorkflowToolParts + run_workflow debug:true
 *   → 真 web_fetch(storeOnly) / regex_extract / display_json_list
 *
 * 全链路走生产代码，不用 mock 糊；网络层只把 fetchImpl 换成本地字节
 * （内联代表性 HTML + 真实百度页面快照），其余全是生产实现。
 * 目的：
 *   1. 证明内置算子无需任何插件 / 启停闸门即自动进算子表；
 *   2. 证明改版后的 3 步 DAG 能真跑出列表（不再有 json_extract 整形步）；
 *   3. 保留真实快照 52 命中 / 51 去重的既有断言，防算法回归。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import type { IPluginRuntime } from '@domain/plugin/types';
import { createOperatorRegistry } from '../../plugin/OperatorRegistry';
import { PluginArtifactService } from '../../plugin/PluginArtifactService';
import { InMemoryPluginArtifactStore } from '../../../infrastructure/plugin/InMemoryPluginArtifactStore';
import { createSkillRegistry } from '../../skill/SkillRegistry';
import { createBasicPrimitives } from '../../skill/primitives/BasicPrimitives';
import {
  REGEX_MATCH_TOOL_NAME, REGEX_EXTRACT_TOOL_NAME, REGEX_REPLACE_TOOL_NAME,
} from '../../skill/primitives/RegexPrimitives';
import { createSkillDevKit } from '../../skill/dev/SkillDevTools';
import { UserSkillStore } from '../../skill/dev/UserSkillStore';
import { buildWorkflowToolParts, RUN_WORKFLOW_TOOL_NAME } from '../../skill/WorkflowTool';

/** 插件工件库保持为空；若误跑了任何插件算子，这个 runtime 会立刻炸，故能证明零插件依赖。 */
function noPluginRuntime(): IPluginRuntime {
  return {
    run: async () => { throw new Error('本回归不应执行任何插件算子（正则已内置）'); },
    dispose: async () => undefined,
  };
}

// ---------------------------------------------------------------- 可交付产物：「百度热搜」技能配方

/** 真实页面结构：HTML 里嵌 "word":"…"（见 /tmp/baidu_proxy.html 实测 52 命中 / 51 去重） */
const BAIDU_URL = 'https://top.baidu.com/board?tab=realtime';
const BAIDU_PATTERN = '"word"\\s*:\\s*"([^"]+)"';

/**
 * 3 步 DAG（改版后）：web_fetch(storeOnly) 出正文 value → 内置 regex_extract
 * 直接产出 [{value,index}] 对象数组 → display_json_list 按 value 字段渲染。
 * 旧版插件返回 {matches,count} 外壳、需 json_extract 再整形一步，已不需要。
 */
const BAIDU_RECIPE = {
  name: '百度热搜',
  summary: '取回百度实时热搜榜页面，用宿主内置正则算子提取热搜关键词，并由宿主以列表直接展示',
  routeHint: ['百度热搜', '热搜榜', '实时热搜'],
  primitives: [],
  prompt: '已把百度实时热搜关键字以列表展示给用户；如实告知任务已完成、结果见宿主呈现，'
    + '不要复述或补写数据内容，也不要把网页正文读回上下文。',
  workflow: {
    steps: [
      {
        id: 'fetch', call: 'web_fetch',
        args: { url: BAIDU_URL, storeOnly: true },
      },
      {
        id: 'extract', call: REGEX_EXTRACT_TOOL_NAME, yield: true,
        args: { pattern: BAIDU_PATTERN, group: 1, unique: true, withIndex: true },
        bindings: [{ from: 'fetch', path: '$', as: 'text' }],
      },
      {
        id: 'show', call: 'display_json_list',
        args: {
          format: 'list',
          fields: [{ key: 'value', label: '热搜关键词' }],
          note: '数据来源：百度热搜榜（实时）',
        },
        bindings: [{ from: 'extract', path: '$', as: 'value' }],
      },
    ],
  },
};

/** 内联代表性页面片段：真实结构 + 首尾重复 + 中文引号 + 别处有 HTML 实体 */
const INLINE_HTML = '<div data-x="{&quot;a&quot;:1}">'
  + '{"appUrl":"https://www.baidu.com/s?wd=x","word":"培养更多高技能人才和大国工匠","isTop":true},'
  + '{"word":"上海市委书记陈吉宁被查"},'
  + '{"word":"太平洋暖得“失控”了"},'
  + '{"word":"新娘提1341次分手新郎回1342次不行"},'
  + '{"word":"培养更多高技能人才和大国工匠"}'
  + '</div>';

// ---------------------------------------------------------------- 装配 helper

function memAdapter() {
  const data = new Map<string, unknown>();
  return {
    initialize: async () => {},
    read: async <T>(key: string) => (data.has(key) ? (data.get(key) as T) : null),
    write: async <T>(key: string, value: T) => { data.set(key, value); },
    delete: async (key: string) => { data.delete(key); },
  };
}

/** 生产 web_fetch 只把网络层换成给定字节；其余（缓存/storeOnly/value 透传）全真 */
function webDepsFor(body: string) {
  return {
    proxyUrl: 'https://api.weiqi.lol',
    timeoutMs: 60_000,
    fetchImpl: (async () => ({
      status: 200, statusText: 'OK', ok: true,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
      text: async () => body,
    })) as unknown as typeof fetch,
  };
}

interface Assembled {
  artifacts: PluginArtifactService;
  users: UserSkillStore;
  devKit: ReturnType<typeof createSkillDevKit>;
  primitives: ReturnType<typeof createSkillRegistry>;
  savedId: string;
  recipes: readonly { id: string; workflow?: unknown; inputs?: unknown }[];
}

/** 一次完整装配：只有 skill_write（无 plugin_write / 无启停闸门） */
async function assemble(body: string): Promise<Assembled> {
  const persist = new Map<string, string>();
  const store = new InMemoryPluginArtifactStore(persist);
  const artifacts = new PluginArtifactService(store);

  // 真 skill_write：纯声明 workflow DAG 落 UserSkillStore
  const users = new UserSkillStore({ localStorage: memAdapter() as never });
  const primitives = createSkillRegistry(createBasicPrimitives(webDepsFor(body)));
  const devKit = createSkillDevKit({ users, primitives });
  const saved = await devKit.executors['skill_write']!(JSON.stringify(BAIDU_RECIPE));
  expect(saved.ok).toBe(true);
  const entries = await users.list();
  expect(entries).toHaveLength(1);
  const recipe = entries[0]!.recipe;
  expect(recipe.workflow).toBeDefined();
  const savedId = recipe.id;

  return {
    artifacts, users, primitives, savedId, devKit,
    recipes: [recipe] as unknown as Assembled['recipes'],
  };
}

function registryFor(a: Assembled, body: string) {
  return createOperatorRegistry({
    primitives: createBasicPrimitives(webDepsFor(body)),
    artifacts: a.artifacts,
    runtime: noPluginRuntime(),
  });
}

async function debugRun(a: Assembled, body: string) {
  const registry = await registryFor(a, body);
  // 接宿主内部 hooks：动态读候选 + debug 全绿后翻转启用（与 ChatUseCase 同口径）
  const parts = buildWorkflowToolParts(
    a.recipes as never, registry, undefined, true, a.devKit.workflowHooks,
  );
  return parts.executors[RUN_WORKFLOW_TOOL_NAME]!(
    JSON.stringify({ skillId: a.savedId, inputs: {}, debug: true }),
  );
}

describe('端到端：内置正则算子 + 百度热搜 workflow 技能', () => {
  it('① 三个内置正则算子自动注册，无需插件 / 启停闸门，且不残留插件命名空间', async () => {
    const a = await assemble(INLINE_HTML);
    const reg = await registryFor(a, INLINE_HTML);

    for (const name of [REGEX_MATCH_TOOL_NAME, REGEX_EXTRACT_TOOL_NAME, REGEX_REPLACE_TOOL_NAME]) {
      expect(reg.specs.has(name)).toBe(true);
    }
    // 旧插件口径的 <slug>.<method> 名字不再出现在算子表
    expect(reg.specs.has('regex.extractAll')).toBe(false);
    expect(reg.specs.has('regex_extract.extract')).toBe(false);

    // 直接按名执行三个内置算子（runtime 是「一跑就炸」的桩，能跑通即证明零插件依赖）
    const match = await reg.run(REGEX_MATCH_TOOL_NAME, { text: 'ab12', pattern: '([a-z]+)(\\d+)' });
    expect(match.value).toEqual({ matched: true, match: 'ab12', index: 0, groups: ['ab', '12'] });
    const extract = await reg.run(REGEX_EXTRACT_TOOL_NAME, {
      text: 'a1 b2', pattern: '([a-z])\\d', group: 1, unique: true, withIndex: true,
    });
    expect(extract.value).toEqual([{ value: 'a', index: 0 }, { value: 'b', index: 3 }]);
    const replace = await reg.run(REGEX_REPLACE_TOOL_NAME, {
      text: 'a1 b2', pattern: '\\d', replacement: '#',
    });
    expect(replace.value).toBe('a# b#');
  });

  it('② debug:true 真跑三步，每步输出 + 最终列表都回灌（4 条去重）', async () => {
    const a = await assemble(INLINE_HTML);
    const outcome = await debugRun(a, INLINE_HTML);
    expect(outcome.ok).toBe(true);
    expect(outcome.observation).toContain('调试模式');
    expect(outcome.observation).toContain('第 1/3 步 fetch');
    expect(outcome.observation).toContain('第 2/3 步 extract');
    expect(outcome.observation).toContain(REGEX_EXTRACT_TOOL_NAME);
    expect(outcome.observation).toContain('第 3/3 步 show');
    expect(outcome.observation).toContain('最终交付');
    // 去重后 4 条：首条与末条重复，按出现顺序保留一次
    expect(outcome.displayMarkdown ?? '').toContain('培养更多高技能人才和大国工匠');
    expect(outcome.displayMarkdown ?? '').toContain('上海市委书记陈吉宁被查');
    expect(outcome.displayMarkdown ?? '').toContain('太平洋暖得“失控”了');
    const bullets = (outcome.displayMarkdown ?? '').split('\n').filter((l) => l.startsWith('- '));
    expect(bullets).toHaveLength(4);
  });

  it('③ 对真实百度页面快照（本次实测抓取）验证：52 命中 / 51 去重 + 列表', async () => {
    const realPath = '/tmp/baidu_proxy.html';
    if (!existsSync(realPath)) return; // 只在本次有快照的编译机上跑，不阻塞移植
    const body = readFileSync(realPath, 'utf8');
    const a = await assemble(body);
    const outcome = await debugRun(a, body);
    expect(outcome.ok).toBe(true);
    const bullets = (outcome.displayMarkdown ?? '').split('\n').filter((l) => l.startsWith('- '));
    console.log('[baidu-realtime] 真实页面去重后条数 =', bullets.length,
      '| 首条 =', bullets[0], '| 末条 =', bullets[bullets.length - 1]);
    expect(bullets.length).toBe(51); // 实测 52 命中、1 条首尾重复
    expect(bullets[0]).toContain('培养更多高技能人才和大国工匠');
  });
});
