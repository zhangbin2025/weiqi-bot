/**
 * 端到端闭环回归（18:39 用户授权「自己模拟测试一把」）：
 *   skill_write 存带 workflow 的配方 → loadSkills 读回 → dev 角色装配 →
 *   工具清单里有 run_workflow → debug:true 真跑 DAG → 每步输出 + 最终交付回灌。
 *
 * 复刻用户实际场景：web_fetch(storeOnly) → json_extract → display_json_list，
 * 专门验用户点名的两处不确定：
 *   - web_fetch 的 storeOnly 出参怎么传给提取节点（bindings.from / path:'$'）
 *   - json_extract 的投影形状（value 是 {list: string[]}）
 *
 * 用内存 LocalStorageAdapter 桩 + 内存算子表，不打网络、不碰真实 localStorage、
 * 不依赖 QuickJS / 插件系统装配。
 */

import { describe, it, expect, vi } from 'vitest';
import { ChatUseCase } from '../ChatUseCase';
import type { ChatRoleId } from '../ChatRole';
import type { IModelGateway } from '../../model/IModelGateway';
import type { ChatHistoryManager } from '../../assistant/ChatHistoryManager';
import type { IMessageRenderer } from '../../assistant/IMessageRenderer';
import { createSkillRegistry } from '../../skill/SkillRegistry';
import { createBasicPrimitives } from '../../skill/primitives/BasicPrimitives';
import { buildWorkflowToolParts } from '../../skill/WorkflowTool';
import { createSkillDevKit } from '../../skill/dev/SkillDevTools';
import { UserSkillStore } from '../../skill/dev/UserSkillStore';
import type { OperatorRegistry } from '../../plugin/OperatorRegistry';
import type { OperatorSpec, StepResult } from '@domain/plugin/types';
import type { ToolKit } from '../ToolLoop';
import { RUN_WORKFLOW_TOOL_NAME } from '../../skill/WorkflowTool';

const WORDS = ['柯洁', '申真谞', '官子', '劫争'];
const PAGE_TEXT = JSON.stringify(WORDS.map((word) => ({ word })));

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

  // web_fetch 的 storeOnly 语义：正文不进模型观察，只作为 value 传给下游。
  add('web_fetch', () => ({ value: PAGE_TEXT }));
  // json_extract 的投影形状：输出 {list: T[]}，word 字段来自 "word":"…" 结构。
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

function gateway() {
  return {
    isReady: vi.fn(() => true),
    execute: vi.fn().mockResolvedValue({ text: '好的', truncated: false }),
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

/** 真实链路：skill_write 写库 → 同一个 UserSkillStore 供 loadSkills / devKit */
async function make(roleId: ChatRoleId, gw: ReturnType<typeof gateway>) {
  const users = new UserSkillStore({ localStorage: memAdapter() as never });
  const primitives = createSkillRegistry(createBasicPrimitives(webDeps));
  const devKit = createSkillDevKit({ users, primitives });
  const registry = makeRegistry();

  // 模型提交的纯声明配方（workflow 三步，bindings 把上游 value 逐节传下去）
  const written = await devKit.executors['skill_write']!(JSON.stringify({
    name: '关键词列表',
    summary: '取页面 → 提取 word → 渲染列表',
    primitives: [],
    prompt: '展示说明',
    inputs: [{ name: 'unused', type: 'string', required: false }],
    workflow: {
      steps: [
        { id: 'fetch', call: 'web_fetch', args: { storeOnly: true }, yield: true },
        {
          id: 'extract', call: 'json_extract', yield: true,
          bindings: [{ from: 'fetch', path: '$', as: 'text' }],
        },
        {
          id: 'render', call: 'display_json_list',
          bindings: [{ from: 'extract', path: '$', as: 'value' }],
        },
      ],
    },
  }));
  expect(written.ok).toBe(true);

  const loadSkills = () => users.list().then((es) => es.filter((e) => e.enabled).map((e) => e.recipe));
  const recipes = await loadSkills();
  const savedId = recipes[0]!.id;

  const skills = {
    loadSkills,
    primitives,
    devKit,
    // 关键：本轮路由不命中（模型刚写完、用户没说触发词）
    routeSkills: async () => [],
  };
  const uc = new ChatUseCase(
    gw, history(), renderer(), pluginKit, () => roleId, webDeps, skills,
    undefined, undefined, registry,
  );
  return { uc, registry, recipes, savedId };
}

function firstReq(gw: ReturnType<typeof gateway>) {
  return gw.execute.mock.calls[0]![0] as {
    tools?: Array<{ name: string; description?: string; parameters?: Record<string, unknown> }>;
    messages: Array<{ role: string; content: string }>;
  };
}

describe('端到端：写完 workflow 技能当场 debug 验收', () => {
  it('dev 角色：工具清单挂 run_workflow，skillId enum 含刚写配方', async () => {
    const gw = gateway();
    const { uc, recipes, savedId } = await make('dev', gw);
    expect(recipes).toHaveLength(1);
    expect(recipes[0]!.workflow).toBeDefined(); // workflow 字段确实存下来了
    await uc.send('验收一下这个技能');

    const req = firstReq(gw);
    const names = (req.tools ?? []).map((t) => t.name);
    expect(names).toContain('run_workflow');
    expect(names).toContain('skill_write');
    const wf = (req.tools ?? []).find((t) => t.name === 'run_workflow')!;
    const props = (wf.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    expect(props['debug']).toBeDefined();
    const enumIds = (props['skillId'] as { enum?: string[] }).enum ?? [];
    expect(enumIds).toContain(savedId);
  });

  it('debug:true 真跑 DAG：每步输出 + 最终交付都回灌，关键词文本与条数可逐条核对', async () => {
    const gw = gateway();
    const { uc, registry, recipes, savedId } = await make('dev', gw);
    await uc.send('验收一下这个技能'); // 先确认装配能进 tool loop

    // 与 ChatUseCase 同源：用 recipes + 同一份 registry 构造 dev 侧 executor
    const parts = buildWorkflowToolParts(recipes, registry, undefined, true);
    const outcome = await parts.executors[RUN_WORKFLOW_TOOL_NAME]!(
      JSON.stringify({ skillId: savedId, inputs: {}, debug: true }),
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.observation).toContain('调试模式');
    // 三步的逐步数据都在
    expect(outcome.observation).toContain('第 1/3 步 fetch');
    expect(outcome.observation).toContain('第 2/3 步 extract');
    expect(outcome.observation).toContain('第 3/3 步 render');
    // web_fetch 的 storeOnly 出参确实传给了 extract（PAGE_TEXT 出现在 fetch 输出里，
    // JSON.stringify 后引号带反斜杠，故用转义形态断言）
    expect(outcome.observation).toContain(String.raw`\"word\":\"柯洁\"`);
    // json_extract 的投影形状 {list:[...]} 可见，模型能数条数
    expect(outcome.observation).toContain('"list"');
    // 最终交付：每个关键词文本都在展示块里
    for (const w of WORDS) expect(outcome.observation).toContain(w);
    expect(outcome.observation).toContain('最终交付');
    expect(outcome.displayMarkdown).toBe(WORDS.map((w) => `- ${w}`).join('\n'));
  });

  it('chat 角色：不挂 run_workflow / skill_write（零额外 token）', async () => {
    const gw = gateway();
    const { uc } = await make('chat', gw);
    await uc.send('你好');
    const names = (firstReq(gw).tools ?? []).map((t) => t.name);
    expect(names).not.toContain('run_workflow');
    expect(names).not.toContain('skill_write');
  });
});
