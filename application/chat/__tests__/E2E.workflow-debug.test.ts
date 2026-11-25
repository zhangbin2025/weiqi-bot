/**
 * 端到端闭环回归（2026-11-25 重写为「同一轮 ToolLoop」）：
 *   轮初技能库为空 → 模型同轮 skill_write 写 workflow 配方 →
 *   紧接着 run_workflow(debug:true) 真跑 DAG → 每步输出 + 最终交付回灌 →
 *   宿主把该技能翻转为已启用（调试通过才启用）。
 *
 * 这是用户实测卡点的直接回归：轮初快照为空时旧 executor 回「未找到技能」，
 * 同轮连改几版配方也只会反复跑轮初那一版。现在 executor 每次调用经
 * devKit.workflowHooks 重新读本地库（含未验收停用的候选）。
 *
 * 用内存 LocalStorageAdapter 桩 + 内存算子表 + 按序返回 tool_calls 的 gateway 桩，
 * 不打网络、不碰真实 localStorage、不依赖 QuickJS / 插件系统装配。
 */

import { describe, it, expect, vi } from 'vitest';
import { ChatUseCase } from '../ChatUseCase';
import type { ChatRoleId } from '../ChatRole';
import type { IModelGateway, ModelRequest, ModelResult, ModelToolCall } from '../../model/IModelGateway';
import type { ChatHistoryManager } from '../../assistant/ChatHistoryManager';
import type { IMessageRenderer } from '../../assistant/IMessageRenderer';
import { createSkillRegistry } from '../../skill/SkillRegistry';
import { createBasicPrimitives } from '../../skill/primitives/BasicPrimitives';
import { createSkillDevKit } from '../../skill/dev/SkillDevTools';
import { UserSkillStore } from '../../skill/dev/UserSkillStore';
import type { OperatorRegistry } from '../../plugin/OperatorRegistry';
import type { OperatorSpec, StepResult } from '@domain/plugin/types';
import type { ToolKit } from '../ToolLoop';

const WORDS = ['柯洁', '申真谞', '官子', '劫争'];
const PAGE_TEXT = JSON.stringify(WORDS.map((word) => ({ word })));
const SKILL_NAME = '关键词列表';

function memAdapter() {
  const data = new Map<string, unknown>();
  return {
    initialize: async () => {},
    read: async <T>(key: string) => (data.has(key) ? (data.get(key) as T) : null),
    write: async <T>(key: string, value: T) => { data.set(key, value); },
    delete: async (key: string) => { data.delete(key); },
  };
}

/** 内存算子表：复刻 web_fetch(storeOnly) → json_extract → display_json_list */
function makeRegistry(): OperatorRegistry {
  const specs = new Map<string, OperatorSpec>();
  const add = (
    name: string,
    fn: (args: Record<string, unknown>) => StepResult,
  ): void => { specs.set(name, { name, idempotent: true, run: async (args) => fn(args) }); };

  add('web_fetch', () => ({ value: PAGE_TEXT }));
  add('json_extract', (args) => {
    const raw = typeof args['text'] === 'string' ? args['text'] : PAGE_TEXT;
    const words = [...raw.matchAll(/"word":"([^"]+)"/g)].map((m) => m[1]!);
    return { value: { list: words } };
  });
  add('display_json_list', (args) => {
    const v = args['value'] as { list?: string[] } | undefined;
    const list = v?.list ?? [];
    return {
      value: null,
      effects: [{ displayMarkdown: list.map((w) => `- ${w}`).join('\n') }],
    };
  });

  return {
    specs,
    get: (name: string) => specs.get(name),
    run: async (name: string, args: Record<string, unknown>): Promise<StepResult> => {
      const op = specs.get(name);
      if (!op) throw new Error(`未注册的算子：${name}`);
      return op.run(args);
    },
  };
}

const webDeps = {
  proxyUrl: 'https://api.weiqi.lol', timeoutMs: 60_000,
  fetchImpl: vi.fn() as unknown as typeof fetch,
};

/** 模型提交的纯声明配方（三步 DAG）：每次可换节点 id，模拟「同轮改版」 */
function recipeArgs(stepIds: readonly [string, string, string]) {
  return {
    name: SKILL_NAME,
    summary: '取页面 → 提取 word → 渲染列表',
    primitives: [],
    prompt: '展示说明',
    inputs: [{ name: 'unused', type: 'string', required: false }],
    workflow: {
      steps: [
        { id: stepIds[0], call: 'web_fetch', args: { storeOnly: true }, yield: true },
        {
          id: stepIds[1], call: 'json_extract', yield: true,
          bindings: [{ from: stepIds[0], path: '$', as: 'text' }],
        },
        {
          id: stepIds[2], call: 'display_json_list',
          bindings: [{ from: stepIds[1], path: '$', as: 'value' }],
        },
      ],
    },
  };
}

/**
 * 按调用顺序返回 tool_calls 的网关桩：每一步都是「模型的一次决策」，
 * 最后一步给最终文本结束本轮。所有工具调用发生在同一条 send() / 同一个 ToolLoop。
 */
function scriptedGateway(steps: ModelToolCall[][]): IModelGateway & {
  execute: ReturnType<typeof vi.fn>;
} {
  let i = 0;
  const execute = vi.fn(async (_req: ModelRequest): Promise<ModelResult> => {
    const calls = steps[i];
    i += 1;
    if (calls === undefined || calls.length === 0) {
      return { text: '验收完成', truncated: false };
    }
    return { text: '', truncated: false, toolCalls: calls };
  });
  return {
    isReady: vi.fn(() => true),
    execute,
  } as unknown as IModelGateway & { execute: ReturnType<typeof vi.fn> };
}

function history() {
  const store: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  return {
    getMessages: vi.fn(() => store),
    getCurrentSession: vi.fn(() => ({ sessionId: 's1', messages: store })),
    addMessage: vi.fn(async (m: { role: 'user' | 'assistant'; content: string }) => { store.push(m); }),
    setCurrentSessionTitle: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatHistoryManager;
}

function renderer() {
  return {
    renderMessage: vi.fn().mockResolvedValue(undefined),
    clearMessages: vi.fn(),
    showTyping: vi.fn(),
    hideTyping: vi.fn(),
    showCountdownJump: vi.fn(),
    renderPluginTrace: vi.fn().mockResolvedValue(undefined),
    beginPluginTrace: vi.fn().mockReturnValue(true),
    appendPluginTraceStep: vi.fn(),
    finishPluginTrace: vi.fn(),
  } as unknown as IMessageRenderer;
}

const pluginKit: ToolKit = {
  tools: [{ name: 'plugin_list', description: 'list', parameters: { type: 'object' } }],
  executors: {
    plugin_list: async () => ({ observation: '空', ok: true, detail: 'list' }),
  },
  systemPrompt: () => Promise.resolve('插件开发'),
};

interface Fixture {
  uc: ChatUseCase;
  users: UserSkillStore;
  /** 所有 gateway 请求里的 role:'tool' 观察文本（按发生顺序） */
  observations(): string[];
  firstTools(): string[];
}

/** 真实链路：轮初技能库为空；devKit / ChatUseCase 共用同一个 UserSkillStore */
async function make(
  roleId: ChatRoleId,
  gw: ReturnType<typeof scriptedGateway>,
): Promise<Fixture> {
  const users = new UserSkillStore({ localStorage: memAdapter() as never });
  const primitives = createSkillRegistry(createBasicPrimitives(webDeps));
  const devKit = createSkillDevKit({ users, primitives });
  const registry = makeRegistry();

  // loadSkills 与 SkillCatalogService 同口径：只返回 enabled 条目。
  // 轮初为空（尚未 skill_write），正好复刻用户「本轮可用技能：（无）」的场景。
  const loadSkills = () => users.list().then(
    (es) => es.filter((e) => e.enabled).map((e) => e.recipe),
  );
  const skills = {
    loadSkills,
    primitives,
    devKit,
    // 本轮路由不命中（模型刚写完、用户没说触发词）
    routeSkills: async () => [],
  };
  const uc = new ChatUseCase(
    gw, history(), renderer(), pluginKit, () => roleId, webDeps, skills,
    undefined, undefined, registry,
  );
  return {
    uc, users,
    // ToolLoop 的 messages 是累积的：最后一次请求已按发生顺序含全部 tool 观察。
    // flatMap 所有请求会把同一条观察重复统计。
    observations: () => {
      const last = gw.execute.mock.calls.at(-1)![0] as ModelRequest;
      return last.messages
        .filter((m) => m.role === 'tool' && typeof m.content === 'string')
        .map((m) => m.content as string);
    },
    firstTools: () => {
      const req = gw.execute.mock.calls[0]![0] as ModelRequest;
      return (req.tools ?? []).map((t) => t.name);
    },
  };
}

function call(id: string, name: string, args: unknown): ModelToolCall {
  return { id, name, arguments: JSON.stringify(args) };
}

/** 从 skill_write 的观察里拿宿主生成的 id（模型下一步要原样填进 run_workflow） */
function idFrom(observation: string): string {
  const m = /id=(user\.[a-z0-9-]+)/.exec(observation);
  if (!m) throw new Error(`skill_write 观察里没有 id：${observation}`);
  return m[1]!;
}

/** 让模型在看到 skill_write 观察后动态决定下一次 run_workflow 的 skillId */
function dynamicGateway(
  plan: (writeObservation: string, step: number) => ModelToolCall[] | null,
): ReturnType<typeof scriptedGateway> {
  let i = 0;
  const execute = vi.fn(async (req: ModelRequest): Promise<ModelResult> => {
    const lastTool = [...req.messages].reverse().find((m) => m.role === 'tool');
    const obs = typeof lastTool?.content === 'string' ? lastTool.content : '';
    // 第 0 步没有 tool 观察，但模型仍要主动发起 skill_write（plan 用 obs='' 兜底）
    const calls = plan(obs, i);
    i += 1;
    if (calls === null || calls.length === 0) return { text: '验收完成', truncated: false };
    return { text: '', truncated: false, toolCalls: calls };
  });
  return {
    isReady: vi.fn(() => true),
    execute,
  } as unknown as ReturnType<typeof scriptedGateway>;
}

describe('端到端：同一轮 skill_write → run_workflow(debug:true)', () => {
  it('轮初技能库为空：同轮写完就能跑，debug 全绿后宿主启用（调试通过才启用）', async () => {
    // 第 1 次决策：skill_write；看到它的观察后（第 2 次决策）用同一 id 跑 debug；
    // 之后的决策直接给最终文本。全部在同一个 send() / ToolLoop 内。
    const gw = dynamicGateway((obs, step) => {
      if (step === 0) return [call('c1', 'skill_write', recipeArgs(['fetch', 'extract', 'render']))];
      if (step === 1) {
        return [call('c2', 'run_workflow', {
          skillId: idFrom(obs), inputs: {}, debug: true,
        })];
      }
      return [];
    });
    const f = await make('dev', gw);
    await f.uc.send('写一个关键词列表技能并当场验收');

    const names = f.firstTools();
    expect(names).toContain('run_workflow');
    expect(names).toContain('skill_write');
    // dev 不再写死 skillId enum：同轮新写的技能不可能出现在装配期清单里
    const wfTool = (gw.execute.mock.calls[0]![0] as ModelRequest)
      .tools!.find((t) => t.name === 'run_workflow')!;
    const skillIdProp = (wfTool.parameters as { properties?: Record<string, unknown> })
      .properties?.['skillId'] as { enum?: string[]; description?: string };
    expect(skillIdProp.enum).toBeUndefined();
    expect(skillIdProp.description).toContain('skill_list');

    const obs = f.observations();
    expect(obs).toHaveLength(2);
    expect(obs[0]).toContain('未启用（待验收）');
    // 不再是「未找到技能 / 本轮可用技能：（无）」
    expect(obs[1]).not.toContain('未找到技能');
    expect(obs[1]).toContain('调试模式');
    expect(obs[1]).toContain('第 1/3 步 fetch');
    expect(obs[1]).toContain('第 2/3 步 extract');
    expect(obs[1]).toContain('第 3/3 步 render');
    expect(obs[1]).toContain(String.raw`\"word\":\"柯洁\"`);
    expect(obs[1]).toContain('"list"');
    expect(obs[1]).toContain('最终交付');
    expect(obs[1]).toContain('技能已启用');
    for (const w of WORDS) expect(obs[1]).toContain(w);

    // 闸门：写完后未启用，只有 debug 全绿才翻转
    const entries = await f.users.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.enabled).toBe(true);
    expect(entries[0]?.recipe.version).toBe(1);
  });

  it('同一轮连改两版：第二次 debug 跑的是最新版 DAG，且修订重置闸门', async () => {
    // 决策序列：写 v1 → 写 v2（同一 id）→ debug 复跑 → 结束。
    // 关键断言：debug 观察里出现的是 v2 的节点 id（v2_fetch / v2_render），
    // 而不是装配期空库或 v1 的旧 5 步结构。
    const gw = dynamicGateway((obs, step) => {
      if (step === 0) return [call('c1', 'skill_write', recipeArgs(['fetch', 'extract', 'render']))];
      if (step === 1) {
        return [call('c2', 'skill_write', {
          ...recipeArgs(['v2_fetch', 'v2_extract', 'v2_render']),
          id: idFrom(obs),
        })];
      }
      if (step === 2) {
        return [call('c3', 'run_workflow', {
          skillId: idFrom(obs), inputs: {}, debug: true,
        })];
      }
      return [];
    });
    const f = await make('dev', gw);
    await f.uc.send('改两版再验收');

    const obs = f.observations();
    expect(obs).toHaveLength(3);
    expect(obs[2]).toContain('第 1/3 步 v2_fetch');
    expect(obs[2]).toContain('第 3/3 步 v2_render');
    expect(obs[2]).not.toContain('第 1/3 步 fetch');
    expect(obs[2]).toContain('技能已启用');

    const entries = await f.users.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.recipe.version).toBe(2); // 同轮修订真的落库了
    expect(entries[0]?.enabled).toBe(true);    // 最新这版 debug 通过后才启用
  });

  it('debug 失败不启用：宿主不谎报验收通过，技能仍是待验收', async () => {
    // 用未注册的算子名让 DAG 在第 1 步短路失败，其余链路完全真实。
    const badRecipe = {
      ...recipeArgs(['fetch', 'extract', 'render']),
      workflow: {
        steps: [
          { id: 'fetch', call: 'web_fetch', args: { storeOnly: true }, yield: true },
          { id: 'explode', call: 'missing.operator' },
        ],
      },
    };
    const gw = dynamicGateway((obs, step) => {
      if (step === 0) return [call('c1', 'skill_write', badRecipe)];
      if (step === 1) {
        return [call('c2', 'run_workflow', {
          skillId: idFrom(obs), inputs: {}, debug: true,
        })];
      }
      return [];
    });
    const f = await make('dev', gw);
    await f.uc.send('验收一个会失败的技能');

    const obs = f.observations();
    expect(obs).toHaveLength(2);
    expect(obs[1]).toContain('调试模式');
    expect(obs[1]).toContain('未注册算子');
    expect(obs[1]).not.toContain('技能已启用');
    const entries = await f.users.list();
    expect(entries[0]?.enabled).toBe(false);
  });

  it('chat 角色：不挂 run_workflow / skill_write（零额外 token）', async () => {
    const gw = scriptedGateway([]);
    const f = await make('chat', gw);
    await f.uc.send('你好');
    expect(f.firstTools()).not.toContain('run_workflow');
    expect(f.firstTools()).not.toContain('skill_write');
  });
});
