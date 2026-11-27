/**
 * WorkflowTool（run_workflow）单测：成功观察「完成 + 句柄」契约。
 *
 * 验收点（LLM 不再碰业务数据）：
 * - 即便 yield:true 节点产出了大段业务 value，observation 也**绝不**包含其内容；
 * - 结果内容只走 effects 旁路（displayMarkdown / actionLink），由宿主直接交付用户；
 * - 句柄按实际旁路产物给（展示块 / 动作链接 / 仅宿主内部），不凭空编造；
 * - 失败观察仍是「哪个节点 / 什么错 / 已完成节点」，不带任何业务 value；
 * - 无 active workflow 配方时零工具零额外 token。
 *
 * 2026-11-25 B2：returnToLLM:true 配方改为「宿主缓存 + workflow_result_read 分页读全」，
 * 成功观察只回元信息 + 结果句柄 + 指路，不含数据本体（消除双重裁剪）。
 *
 * 纯内存假 registry，不依赖 QuickJS / 网络 / DOM。
 */

import { describe, it, expect } from 'vitest';
import type { PluginTraceStep, StepResult, OperatorSpec } from '@domain/plugin/types';
import type { OperatorRegistry } from '@application/plugin/OperatorRegistry';
import type { SkillRecipe, WorkflowSpec, WorkflowStep } from '../SkillTypes';
import { CONTEXT_LIMITS } from '@application/chat/ConversationPrompt';
import {
  buildWorkflowToolParts, RUN_WORKFLOW_TOOL, RUN_WORKFLOW_TOOL_NAME,
  WORKFLOW_RESULT_READ_TOOL_NAME, WORKFLOW_RESULT_READ_TOOL,
} from '../WorkflowTool';

/** 与 WorkflowRunner.test.ts 同形的内存假算子表。 */
function fakeRegistry(
  ops: Record<string, (args: Record<string, unknown>) => StepResult | Promise<StepResult>>,
): OperatorRegistry {
  const specs = new Map<string, OperatorSpec>();
  for (const [name, fn] of Object.entries(ops)) {
    specs.set(name, { name, description: name, inputSchema: { type: 'object' }, outputSchema: {}, kind: 'pure', idempotent: true, run: async (args) => fn(args) });
  }
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

function recipe(
  over: Partial<SkillRecipe> & Pick<SkillRecipe, 'id'>,
): SkillRecipe {
  return {
    schemaVersion: 1,
    version: 1,
    name: '测试工作流',
    summary: '测试',
    primitives: [],
    prompt: '测试',
    ...over,
  };
}

function run(
  active: readonly SkillRecipe[],
  registry: OperatorRegistry,
  args: Record<string, unknown>,
  devMode = false,
) {
  const parts = buildWorkflowToolParts(active, registry, (_s: PluginTraceStep) => undefined, devMode);
  const executor = parts.executors[RUN_WORKFLOW_TOOL_NAME]!;
  return executor(JSON.stringify(args));
}

/** 可辨识的业务数据：一旦被 JSON.stringify 回灌，必然出现在观察里。 */
const SECRET_BUSINESS_VALUE = '业务正文-绝不该进模型上下文-9f8e7d6c';
const NEWS_TITLE = '某条新闻标题-不该被模型复述';

describe('buildWorkflowToolParts — 成功观察只回「完成 + 句柄」', () => {
  it('yield:true 节点的业务 value 不进 observation，只走 effects 旁路', async () => {
    const spec: WorkflowSpec = {
      steps: [
        { id: 'fetch', call: 'fetch_data', yield: true },
        {
          id: 'render', call: 'render_list',
          bindings: [{ from: 'fetch', path: '$', as: 'list' }],
        },
      ] as WorkflowStep[],
    };
    const skill = recipe({ id: 'demo.news', workflow: spec });
    const registry = fakeRegistry({
      fetch_data: () => ({ value: { title: SECRET_BUSINESS_VALUE, raw: NEWS_TITLE } }),
      render_list: () => ({
        value: null,
        effects: [{ displayMarkdown: `- ${NEWS_TITLE}` }],
      }),
    });

    const outcome = await run([skill], registry, { skillId: 'demo.news' });

    expect(outcome.ok).toBe(true);
    expect(outcome.observation).toContain('执行完成');
    expect(outcome.observation).toContain('demo.news');
    expect(outcome.observation).toContain('宿主展示块');
    // 关键：两处业务数据一个字都不能回灌
    expect(outcome.observation).not.toContain(SECRET_BUSINESS_VALUE);
    expect(outcome.observation).not.toContain(NEWS_TITLE);
    expect(outcome.observation).not.toContain('title');
    expect(outcome.observation).not.toContain('yield');
    expect(outcome.observation).not.toContain('JSON');
    // 结果内容完整走宿主旁路
    expect(outcome.displayMarkdown).toBe(`- ${NEWS_TITLE}`);
  });

  it('有 actionLink effects 时句柄写明「宿主动作链接」，url 由宿主旁路交付', async () => {
    const skill = recipe({
      id: 'demo.open',
      workflow: { steps: [{ id: 'link', call: 'make_link' }] as WorkflowStep[] },
    });
    const registry = fakeRegistry({
      make_link: () => ({ value: null, effects: [{ actionLink: 'weiqi://open/42' }] }),
    });

    const outcome = await run([skill], registry, { skillId: 'demo.open' });

    expect(outcome.ok).toBe(true);
    expect(outcome.observation).toContain('宿主动作链接');
    expect(outcome.observation).not.toContain('weiqi://open/42');
    expect(outcome.actionLink).toEqual({ url: 'weiqi://open/42', label: '测试工作流' });
  });

  it('两种旁路都有时句柄并列；无旁路时如实写「宿主内部」', async () => {
    const withBoth = recipe({
      id: 'demo.both',
      workflow: { steps: [{ id: 'both', call: 'both' }] as WorkflowStep[] },
    });
    const bothReg = fakeRegistry({
      both: () => ({
        value: null,
        effects: [{ displayMarkdown: '正文', actionLink: 'weiqi://x' }],
      }),
    });
    const both = await run([withBoth], bothReg, { skillId: 'demo.both' });
    expect(both.observation).toContain('宿主展示块 + 宿主动作链接');

    const withNone = recipe({
      id: 'demo.none',
      workflow: { steps: [{ id: 'calc', call: 'calc', yield: true }] as WorkflowStep[] },
    });
    const noneReg = fakeRegistry({
      calc: () => ({ value: SECRET_BUSINESS_VALUE }),
    });
    const none = await run([withNone], noneReg, { skillId: 'demo.none' });
    expect(none.observation).toContain('宿主内部（无可见旁路产物）');
    expect(none.observation).not.toContain(SECRET_BUSINESS_VALUE);
  });

  it('失败观察保持结构化（节点/错误/已完成），且不带任何业务 value', async () => {
    const skill = recipe({
      id: 'demo.fail',
      workflow: {
        steps: [
          { id: 'first', call: 'first', yield: true },
          { id: 'boom', call: 'boom' },
        ] as WorkflowStep[],
      },
    });
    const registry = fakeRegistry({
      first: () => ({ value: SECRET_BUSINESS_VALUE }),
      boom: () => { throw new Error('取数失败'); },
    });

    const outcome = await run([skill], registry, { skillId: 'demo.fail' });

    expect(outcome.ok).toBe(false);
    expect(outcome.observation).toContain('workflow 执行失败');
    expect(outcome.observation).toContain('boom');
    expect(outcome.observation).toContain('取数失败');
    expect(outcome.observation).toContain('first');
    expect(outcome.observation).not.toContain(SECRET_BUSINESS_VALUE);
  });

  it('未注册算子：失败观察给出安装提示，不含已删农历插件的具体名字', async () => {
    const skill = recipe({
      id: 'demo.missing',
      workflow: { steps: [{ id: 'x', call: 'missing.op' }] as WorkflowStep[] },
    });
    const registry = fakeRegistry({});

    const outcome = await run([skill], registry, { skillId: 'demo.missing' });

    expect(outcome.ok).toBe(false);
    expect(outcome.observation).toContain('未注册算子:missing.op');
    expect(outcome.observation).toContain('安装对应算子插件');
    expect(outcome.observation).not.toContain('农历');
  });

  it('无 active workflow 配方：不挂工具、零额外 token', () => {
    const parts = buildWorkflowToolParts(
      [recipe({ id: 'plain.chat' })],
      fakeRegistry({}),
    );
    expect(parts.tools).toEqual([]);
    expect(parts.executors).toEqual({});
  });

  it('inputs 契约只给填参约束，不把 default 的值拼进工具说明', () => {
    const SECRET_DEFAULT = '缺省正文-不该进工具说明-5b4a3c2d';
    const skill = recipe({
      id: 'demo.contract',
      workflow: { steps: [{ id: 'only', call: 'noop' }] as WorkflowStep[] },
      inputs: [
        { name: 'year', type: 'integer', required: true },
        { name: 'note', type: 'string', default: SECRET_DEFAULT },
        { name: 'format', type: 'string', default: 'list', enum: ['list', 'table'] },
      ],
    });
    const parts = buildWorkflowToolParts([skill], fakeRegistry({
      noop: () => ({ value: null }),
    }));
    const tool = parts.tools.find((t) => t.name === RUN_WORKFLOW_TOOL_NAME)!;
    const desc = tool.description;
    // 填参约束仍在
    expect(desc).toContain('year: integer，必填');
    expect(desc).toContain('note: string，可省略(有缺省)');
    expect(desc).toContain('format: string，可省略(有缺省)');
    expect(desc).toContain('枚举 ["list","table"]');
    // default 的值一个字都不能披露
    expect(desc).not.toContain(SECRET_DEFAULT);
    expect(desc).not.toContain('缺省 "list"');
    expect(desc).not.toContain('缺省 ');
  });
});

describe('buildWorkflowToolParts — debug 调试开关', () => {
  it('默认（不传 debug）：业务 value 仍不进 observation，逐字保持旧契约', async () => {
    const skill = recipe({
      id: 'demo.debug.off',
      workflow: { steps: [{ id: 'only', call: 'op', yield: true }] as WorkflowStep[] },
    });
    const registry = fakeRegistry({ op: () => ({ value: SECRET_BUSINESS_VALUE }) });
    const outcome = await run([skill], registry, { skillId: 'demo.debug.off' });
    expect(outcome.observation).toContain('执行完成');
    expect(outcome.observation).not.toContain(SECRET_BUSINESS_VALUE);
    expect(outcome.observation).not.toContain('调试模式');
  });

  it('debug:true：每步入参/输出与最终交付结果都回灌，模型能判断对不对', async () => {
    const spec: WorkflowSpec = {
      steps: [
        { id: 'fetch', call: 'fetch_data', yield: true },
        {
          id: 'render', call: 'render_list',
          bindings: [{ from: 'fetch', path: '$', as: 'list' }],
        },
      ] as WorkflowStep[],
    };
    const skill = recipe({ id: 'demo.debug.on', workflow: spec });
    const registry = fakeRegistry({
      fetch_data: () => ({ value: { title: SECRET_BUSINESS_VALUE } }),
      render_list: () => ({
        value: null,
        effects: [{ displayMarkdown: `- ${NEWS_TITLE}` }],
      }),
    });

    const outcome = await run([skill], registry, {
      skillId: 'demo.debug.on', inputs: { q: 'X' }, debug: true,
    }, true);

    expect(outcome.ok).toBe(true);
    expect(outcome.observation).toContain('调试模式');
    expect(outcome.observation).toContain('第 1/2 步 fetch');
    expect(outcome.observation).toContain('第 2/2 步 render');
    // 逐步输出：yield:true 与 yield:false 的节点 value 都可见
    expect(outcome.observation).toContain(SECRET_BUSINESS_VALUE);
    expect(outcome.observation).toContain('list');
    // 最终交付结果（宿主旁路那份）也回灌
    expect(outcome.observation).toContain('最终交付');
    expect(outcome.observation).toContain(NEWS_TITLE);
    // 旁路本身照旧交付，不受调试影响
    expect(outcome.displayMarkdown).toBe(`- ${NEWS_TITLE}`);
  });

  it('debug:true 且失败：失败节点的错误与已完成步的输出都在，便于定位', async () => {
    const skill = recipe({
      id: 'demo.debug.fail',
      workflow: {
        steps: [
          { id: 'first', call: 'first', yield: true },
          { id: 'boom', call: 'boom' },
        ] as WorkflowStep[],
      },
    });
    const registry = fakeRegistry({
      first: () => ({ value: SECRET_BUSINESS_VALUE }),
      boom: () => { throw new Error('取数失败'); },
    });
    const outcome = await run([skill], registry, {
      skillId: 'demo.debug.fail', debug: true,
    }, true);
    expect(outcome.ok).toBe(false);
    expect(outcome.observation).toContain('调试模式');
    expect(outcome.observation).toContain(SECRET_BUSINESS_VALUE); // 已完成步输出
    expect(outcome.observation).toContain('取数失败');            // 失败点
    expect(outcome.observation).toContain('第 2/2 步 boom');
  });

  it('chat 角色工具定义不暴露 debug；开发角色才列进 parameters', () => {
    const skill = recipe({
      id: 'demo.debug.schema',
      workflow: { steps: [{ id: 'x', call: 'noop' }] as WorkflowStep[] },
    });
    const reg = fakeRegistry({ noop: () => ({ value: null }) });
    const chat = buildWorkflowToolParts([skill], reg);
    const dev = buildWorkflowToolParts([skill], reg, undefined, true);
    const chatProps = (chat.tools[0]!.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    const devProps = (dev.tools[0]!.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    expect(chatProps['debug']).toBeUndefined();
    expect(devProps['debug']).toBeDefined();
    expect(dev.tools[0]!.description).toContain('调试');
  });
});


/**
 * 角色硬 gate（上行 token）：debug 逐步回灌把每个算子输出塞进模型上下文，
 * 闲聊角色必须强制关 —— 即便模型传了 debug:true 也只回「完成 + 句柄」，
 * 业务 value 一个字不进上下文，也绝不触发 dev 才有的「调试通过才启用」闸门。
 * 开发角色仍保留显式 debug:true 逐步回灌（见上面 debug 组，已改在 devMode=true 下跑）。
 */
describe('buildWorkflowToolParts — debug 按角色硬 gate（闲聊零逐步回灌）', () => {
  const skill = recipe({
    id: 'demo.debug.gate',
    workflow: {
      steps: [
        { id: 'fetch', call: 'fetch_data', yield: true },
        { id: 'render', call: 'render_list' },
      ] as WorkflowStep[],
    },
  });

  it('chat（devMode=false）即便传 debug:true：也不回灌任何算子输出，走完成+句柄', async () => {
    const registry = fakeRegistry({
      fetch_data: () => ({ value: { title: SECRET_BUSINESS_VALUE } }),
      render_list: () => ({ value: null, effects: [{ displayMarkdown: `- ${NEWS_TITLE}` }] }),
    });
    const outcome = await run([skill], registry, {
      skillId: skill.id, debug: true,
    }); // 不传 devMode = 闲聊角色
    expect(outcome.ok).toBe(true);
    expect(outcome.observation).toContain('执行完成');
    expect(outcome.observation).toContain('结果位置（句柄）');
    expect(outcome.observation).not.toContain('调试模式');
    expect(outcome.observation).not.toContain('第 1/2 步');
    expect(outcome.observation).not.toContain('输出 value');
    expect(outcome.observation).not.toContain(SECRET_BUSINESS_VALUE);
    expect(outcome.observation).not.toContain(NEWS_TITLE);
    // 旁路产物仍照常交付给用户，只是不进模型上下文
    expect(outcome.displayMarkdown).toBe(`- ${NEWS_TITLE}`);
  });

  it('chat + debug:true 不触发 accept 闸门（调试通过才启用只属于 dev）', async () => {
    const accepted: string[] = [];
    const hooks = {
      listCandidates: async () => [{ recipe: skill, enabled: false }],
      accept: async (id: string) => { accepted.push(id); },
    };
    const registry = fakeRegistry({
      fetch_data: () => ({ value: { title: SECRET_BUSINESS_VALUE } }),
      render_list: () => ({ value: null }),
    });
    // 故意给 chat 装配也塞 devHooks：gate 之后 debug 恒 false，accept 绝不会被调
    const parts = buildWorkflowToolParts([skill], registry, undefined, false, hooks);
    const outcome = await parts.executors[RUN_WORKFLOW_TOOL_NAME]!(
      JSON.stringify({ skillId: skill.id, debug: true }),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.observation).not.toContain('调试模式');
    expect(outcome.observation).not.toContain('技能已启用');
    expect(accepted).toEqual([]);
  });
});

/**
 * 回归（18:25）：dev 角色验收时模型没传 debug:true，只回了「没法逐条核对」。
 * 修法是 dev 正常模式观察里给指路，chat 逐字沿用旧「完成+句柄」结束句。
 */
describe('buildWorkflowToolParts — dev 正常模式观察指路（不阻断调试复跑）', () => {
  const skill = recipe({
    id: 'demo.debug.nudge',
    workflow: { steps: [{ id: 'only', call: 'op', yield: true }] },
  });
  const registry = fakeRegistry({
    op: () => ({ value: SECRET_BUSINESS_VALUE }),
  });

  function call(devMode: boolean) {
    const parts = buildWorkflowToolParts([skill], registry, undefined, devMode);
    return parts.executors[RUN_WORKFLOW_TOOL_NAME]!(
      JSON.stringify({ skillId: skill.id, inputs: { text: '示例' } }),
    );
  }

  it('devMode + 不传 debug：观察仍只回完成+句柄，但明确告知可再带 debug:true 复跑', async () => {
    const outcome = await call(true);
    expect(outcome.observation).toContain('执行完成');
    expect(outcome.observation).toContain('结果位置（句柄）');
    // 正常模式绝不回灌业务 value（零回归契约）
    expect(outcome.observation).not.toContain(SECRET_BUSINESS_VALUE);
    expect(outcome.observation).toContain('不要就此下结论');
    expect(outcome.observation).toContain('debug:true');
    expect(outcome.observation).toContain('demo.debug.nudge');
    // 旧结束句不得再出现（它会让模型直接回复用户「没法核对」）
    expect(outcome.observation).not.toContain('请如实告知用户任务已完成');
  });

  it('chat 模式（devMode=false）：观察逐字沿用旧结束句，零变化', async () => {
    const outcome = await call(false);
    expect(outcome.observation).toContain('请如实告知用户任务已完成');
    expect(outcome.observation).not.toContain('不要就此下结论');
    expect(outcome.observation).not.toContain(SECRET_BUSINESS_VALUE);
  });
});


describe('dev 恒定挂载 run_workflow（19:08 散文配方导致工具消失的回归）', () => {
  it('dev + 只有散文配方：仍挂 run_workflow，skillId 不写死 enum（指路 skill_list）', () => {
    const parts = buildWorkflowToolParts(
      [recipe({ id: 'user.baidu.hot', name: '百度热搜' })],
      fakeRegistry({}),
      undefined,
      true,
    );
    // B2：parts.tools 现在同时挂 run_workflow 与 workflow_result_read（A7）；
    // 本断言的意图是「run_workflow 仍恒定挂载」，改用 toContain 保留该意图。
    expect(parts.tools.map((t) => t.name)).toContain(RUN_WORKFLOW_TOOL_NAME);
    expect(parts.tools.map((t) => t.name)).toContain(WORKFLOW_RESULT_READ_TOOL_NAME);
    const def = parts.tools[0]!;
    const props = (def.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    expect(props['debug']).toBeDefined();
    const skillId = props['skillId'] as { enum?: string[]; description?: string };
    // 装配期 enum 会冻结旧 id；同轮 skill_write 出来的技能要靠 skill_list 实时拿
    expect(skillId.enum).toBeUndefined();
    expect(skillId.description).toContain('skill_list');
    expect(def.description).toContain('装配时还没有带 workflow 声明的技能');
  });

  it('dev + 点名散文技能：结构化回执明确说要补 workflow.steps，不是「未找到技能」', async () => {
    const parts = buildWorkflowToolParts(
      [recipe({ id: 'user.baidu.hot', name: '百度热搜' })],
      fakeRegistry({}),
      undefined,
      true,
    );
    const outcome = await parts.executors[RUN_WORKFLOW_TOOL_NAME]!(
      JSON.stringify({ skillId: 'user.baidu.hot', inputs: {}, debug: true }),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.observation).toContain('是散文配方');
    expect(outcome.observation).toContain('workflow.steps');
    expect(outcome.observation).toContain('skill_write');
    expect(outcome.observation).not.toContain('未找到技能');
  });

  it('chat（devMode=false）+ 只有散文配方：逐字不挂工具（零额外 token 契约不变）', () => {
    const parts = buildWorkflowToolParts(
      [recipe({ id: 'plain.chat' })],
      fakeRegistry({}),
    );
    expect(parts.tools).toEqual([]);
    expect(parts.executors).toEqual({});
  });
});


/**
 * 2026-11-25 回归：skill_write 修订在同一轮里必须反映到 run_workflow，
 * 且 workflow 配方只有 debug:true 全绿才由宿主启用（失败不启用）。
 */
describe('buildWorkflowToolParts — dev 动态候选 + 调试通过才启用', () => {
  const v1 = recipe({
    id: 'user.dynamic', version: 1,
    workflow: { steps: [{ id: 'only', call: 'echo', yield: true }] },
  });
  const v2 = recipe({
    id: 'user.dynamic', version: 2,
    workflow: {
      steps: [
        { id: 'first', call: 'echo', yield: true },
        { id: 'second', call: 'echo', yield: true },
      ],
    },
  });

  it('每次调用重新读候选：装配期是 v1，库里改成 v2 后同一次 executor 跑的是 v2', async () => {
    let current: SkillRecipe[] = [v1];
    const hooks = {
      listCandidates: async () => current.map((r) => ({ recipe: r, enabled: false })),
      accept: async () => {},
    };
    const registry = fakeRegistry({ echo: (args) => ({ value: args }) });
    // 装配期 active 只有 v1；executor 不依赖它
    const parts = buildWorkflowToolParts([v1], registry, undefined, true, hooks);
    current = [v2]; // 模拟同一轮 skill_write 把配方改成 v2（两步 DAG）
    const outcome = await parts.executors[RUN_WORKFLOW_TOOL_NAME]!(
      JSON.stringify({ skillId: 'user.dynamic', inputs: {}, debug: true }),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.observation).toContain('第 1/2 步 first');
    expect(outcome.observation).toContain('第 2/2 步 second');
  });

  it('debug:true 成功才调用 accept；失败 / 不带 debug 都不启用', async () => {
    const accepted: string[] = [];
    const hooks = {
      listCandidates: async () => [{ recipe: v1, enabled: false }],
      accept: async (id: string) => { accepted.push(id); },
    };
    const good = fakeRegistry({ echo: () => ({ value: 'OK' }) });
    const goodParts = buildWorkflowToolParts([v1], good, undefined, true, hooks);
    const normal = await goodParts.executors[RUN_WORKFLOW_TOOL_NAME]!(
      JSON.stringify({ skillId: 'user.dynamic', inputs: {} }),
    );
    expect(normal.ok).toBe(true);
    expect(accepted).toEqual([]); // 正常调用不翻闸门

    const passed = await goodParts.executors[RUN_WORKFLOW_TOOL_NAME]!(
      JSON.stringify({ skillId: 'user.dynamic', inputs: {}, debug: true }),
    );
    expect(passed.ok).toBe(true);
    expect(passed.observation).toContain('技能已启用');
    expect(accepted).toEqual(['user.dynamic']);

    const bad = fakeRegistry({ echo: () => { throw new Error('算子炸了'); } });
    const badParts = buildWorkflowToolParts([v1], bad, undefined, true, hooks);
    const failed = await badParts.executors[RUN_WORKFLOW_TOOL_NAME]!(
      JSON.stringify({ skillId: 'user.dynamic', inputs: {}, debug: true }),
    );
    expect(failed.ok).toBe(false);
    expect(failed.observation).not.toContain('技能已启用');
    expect(accepted).toEqual(['user.dynamic']); // 失败没有二次 accept
  });
});


/**
 * B2 / returnToLLM 开关：缺省 / false 逐字保持「完成 + 句柄」观察（8 组 BYTE-IDENTICAL）；
 * true 改为「宿主结果缓存 + workflow_result_read 分页读全」，观察只回完成 + 总字符数 +
 * resultId + 指路 + 读全后分析，不含任何数据本体，整条 ≤ maxCharsPerMessage。
 */
describe('buildWorkflowToolParts — returnToLLM 开关（B2 宿主缓存读全）', () => {
  const YIELD_VALUE = '弈友圈对阵数据-9f8e7d6c';
  const spec: WorkflowSpec = {
    steps: [
      { id: 'fetch', call: 'fetch_data', yield: true },
      { id: 'normalize', call: 'normalize' },
    ] as WorkflowStep[],
  };
  const registry = fakeRegistry({
    fetch_data: () => ({ value: { stats: YIELD_VALUE } }),
    normalize: () => ({ value: null }),
  });

  // ---- 以下 !returnToLLM / debug / fail 断言逐字保持既有语义（零回归） ----

  it('缺省（不写 returnToLLM）：观察不含 yield 汇总 values，逐字保持旧「完成 + 句柄」', async () => {
    const skill = recipe({ id: 'demo.r2l.off', workflow: spec });
    const outcome = await run([skill], registry, { skillId: skill.id });
    expect(outcome.ok).toBe(true);
    expect(outcome.observation).toContain('执行完成');
    expect(outcome.observation).toContain('结果位置（句柄）');
    expect(outcome.observation).toContain('请如实告知用户任务已完成');
    expect(outcome.observation).not.toContain(YIELD_VALUE);
    expect(outcome.observation).not.toContain('yield 汇总 values');
    expect(outcome.observation).not.toContain('据以上数据做关系分析');
  });

  it('returnToLLM:false 与缺省逐字一致（observation 相等）', async () => {
    const off = recipe({ id: 'demo.r2l.cmp', workflow: spec });
    const explicitFalse = recipe({ id: 'demo.r2l.cmp', workflow: spec, returnToLLM: false });
    const a = await run([off], registry, { skillId: off.id });
    const b = await run([explicitFalse], registry, { skillId: explicitFalse.id });
    expect(b.observation).toBe(a.observation);
    expect(b.observation).not.toContain(YIELD_VALUE);
  });

  it('returnToLLM:true 不影响 debug 分支与失败观察（两条既有路径零回归）', async () => {
    const skill = recipe({ id: 'demo.r2l.debug', workflow: spec, returnToLLM: true });
    const debugOutcome = await run([skill], registry, {
      skillId: skill.id, debug: true,
    }, true);
    expect(debugOutcome.observation).toContain('调试模式');
    expect(debugOutcome.observation).not.toContain('据以上数据做关系分析'); // debug 分支不动

    const failSkill = recipe({ id: 'demo.r2l.fail', workflow: spec, returnToLLM: true });
    const failReg = fakeRegistry({
      fetch_data: () => ({ value: YIELD_VALUE }),
      normalize: () => { throw new Error('归一化失败'); },
    });
    const failOutcome = await run([failSkill], failReg, { skillId: failSkill.id });
    expect(failOutcome.ok).toBe(false);
    expect(failOutcome.observation).toContain('workflow 执行失败');
    expect(failOutcome.observation).not.toContain(YIELD_VALUE);
  });

  // ---- 以下 6 条 returnToLLM:true 断言重写为 B2 新语义 ----

  it('① true：观察不含任何数据本体，只回完成 + 总字符数 + resultId + 指路 + 读全后分析', async () => {
    const skill = recipe({ id: 'demo.r2l.on', workflow: spec, returnToLLM: true });
    const outcome = await run([skill], registry, { skillId: skill.id });
    expect(outcome.ok).toBe(true);
    expect(outcome.observation).toContain('执行完成');
    // 完成 + 节点数（firstLine）
    expect(outcome.observation).toContain('已完成 2 个节点');
    // 事实元信息：总字符数
    expect(outcome.observation).toContain('字符，已存入宿主结果缓存');
    // 句柄 + 工具名
    expect(outcome.observation).toContain('resultId');
    expect(outcome.observation).toContain('demo.r2l.on');
    expect(outcome.observation).toContain(WORKFLOW_RESULT_READ_TOOL_NAME);
    // 可照抄示例 + 递增 offset
    expect(outcome.observation).toContain('"mode":"slice"');
    expect(outcome.observation).toContain('mode:"slice"');
    expect(outcome.observation).toContain('offset:0');
    expect(outcome.observation).toContain('递增 offset');
    // 读全后分析 + 不要编造
    expect(outcome.observation).toContain('读全后再做关系分析');
    expect(outcome.observation).toContain('读全后再分析');
    expect(outcome.observation).toContain('不要编造');
    expect(outcome.observation).toContain('不要复述');
    // 关键：数据本体一个字都不回灌（验收会 grep 【yield 汇总 values】 / value 字段）
    expect(outcome.observation).not.toContain('【yield 汇总 values】');
    expect(outcome.observation).not.toContain(YIELD_VALUE);
    expect(outcome.observation).not.toContain('stats');
    expect(outcome.observation).not.toContain('…[已按单条上限截断]');
  });

  it('② true：整条 observation ≤ maxCharsPerMessage（消除 ToolLoop 二次裁剪），不含旧矛盾措辞', async () => {
    const skill = recipe({ id: 'demo.r2l.self', workflow: spec, returnToLLM: true });
    const outcome = await run([skill], registry, { skillId: skill.id });
    expect(outcome.ok).toBe(true);
    expect(outcome.observation.length).toBeLessThanOrEqual(CONTEXT_LIMITS.maxCharsPerMessage);
    // 旧自相矛盾措辞 / 旧结束句全部去掉
    expect(outcome.observation).not.toContain('未进入本轮模型上下文');
    expect(outcome.observation).not.toContain('结果位置（句柄）');
    expect(outcome.observation).not.toContain('由宿主旁路交付');
    expect(outcome.observation).not.toContain('请如实告知用户任务已完成');
    expect(outcome.observation).not.toContain('已进入模型上下文');
    // 消除双重裁剪：指令在观察尾部仍完整（等同 clipObservation 后仍在）
    expect(outcome.observation).toContain('不要编造');
    expect(outcome.observation).toContain('读全后再做关系分析');
  });

  it('③ true：观察里的 resultId = skillId，且与缓存键逐字一致（info 能命中）', async () => {
    const skill = recipe({ id: 'demo.r2l.key', workflow: spec, returnToLLM: true });
    const parts = buildWorkflowToolParts([skill], registry, undefined);
    const wf = await parts.executors[RUN_WORKFLOW_TOOL_NAME]!(
      JSON.stringify({ skillId: skill.id }),
    );
    expect(wf.observation).toContain(`resultId：${skill.id}`);
    const info = await parts.executors[WORKFLOW_RESULT_READ_TOOL_NAME]!(
      JSON.stringify({ resultId: skill.id, mode: 'info' }),
    );
    expect(info.ok).toBe(true);
    expect(info.preparatory).toBe(true);
    expect(info.observation).toContain(skill.id);
    expect(info.detail).toContain('字符');
  });

  it('④ true：工具定义形状与 WEB_CACHE_READ_TOOL 一致（resultId 取代 url），description 不写 http/https', () => {
    const p = WORKFLOW_RESULT_READ_TOOL.parameters as {
      properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean;
    };
    expect(WORKFLOW_RESULT_READ_TOOL.name).toBe('workflow_result_read');
    expect(p.properties).toHaveProperty('resultId');
    expect(p.properties).not.toHaveProperty('url');
    for (const key of ['mode', 'offset', 'length', 'pattern', 'flags', 'before', 'after', 'skip', 'limit', 'count']) {
      expect(p.properties).toHaveProperty(key);
    }
    expect(p.required).toEqual(['resultId', 'mode']);
    expect(p.additionalProperties).toBe(false);
    const mode = (p.properties!['mode'] as { enum?: string[] }).enum;
    expect(mode).toEqual(['info', 'slice', 'grep']);
    const d = WORKFLOW_RESULT_READ_TOOL.description;
    expect(d).toContain('workflow_result_read');
    expect(d).toContain('resultId');
    expect(d).toContain('slice');
    expect(d).toContain('读全');
    expect(d).toContain('不消耗自主决策轮数');
    expect(d).toContain('URL 字样即读取键');
    expect(d).not.toContain('http://');
    expect(d).not.toContain('https://');
  });

  it('⑤ true：buildWorkflowTool 条件追加 description；无 returnToLLM 配方逐字不加', () => {
    const plain = recipe({ id: 'demo.plain', workflow: spec });
    const withR2L = recipe({ id: 'demo.r2l.desc', workflow: spec, returnToLLM: true });
    const plainParts = buildWorkflowToolParts([plain], registry);
    const r2lParts = buildWorkflowToolParts([withR2L], registry);
    const plainDesc = plainParts.tools.find((t) => t.name === RUN_WORKFLOW_TOOL_NAME)!.description;
    const r2lDesc = r2lParts.tools.find((t) => t.name === RUN_WORKFLOW_TOOL_NAME)!.description;
    // 静态常量逐字不动：两段拼装的 description 都以它原文开头
    expect(plainDesc.startsWith(RUN_WORKFLOW_TOOL.description)).toBe(true);
    expect(r2lDesc.startsWith(RUN_WORKFLOW_TOOL.description)).toBe(true);
    expect(plainDesc).toContain('正常调用你只会收到「完成 + 结果位置（句柄）」');
    expect(r2lDesc).toContain('结果句柄配方');
    expect(r2lDesc).toContain(WORKFLOW_RESULT_READ_TOOL_NAME);
    expect(r2lDesc).toContain('不受上面「不要复述/归纳结果内容」的约束');
    // 无此类配方时逐字不加；有则只在尾部多出一段
    expect(plainDesc).not.toContain('结果句柄配方');
    const hintStart = r2lDesc.indexOf('【结果句柄配方');
    expect(hintStart).toBeGreaterThan(0);
    expect(r2lDesc.slice(hintStart - 2, hintStart)).toBe('\n\n');
    // 追加段是尾部：去掉它之后，r2l 与 plain 只是技能清单 id 不同，都不含句柄提示
    const sameShape = r2lDesc.slice(0, hintStart - 2).replace('demo.r2l.desc', 'demo.plain');
    expect(sameShape).toBe(plainDesc);
  });

  it('⑥ true：debug:true 与 returnToLLM:false 都不写缓存（workflow_result_read 报空缓存）', async () => {
    // debug:true 分支不写缓存
    const dSkill = recipe({ id: 'demo.r2l.nocache.debug', workflow: spec, returnToLLM: true });
    const dParts = buildWorkflowToolParts([dSkill], registry, undefined, true);
    await dParts.executors[RUN_WORKFLOW_TOOL_NAME]!(
      JSON.stringify({ skillId: dSkill.id, debug: true }),
    );
    const dRead = await dParts.executors[WORKFLOW_RESULT_READ_TOOL_NAME]!(
      JSON.stringify({ resultId: dSkill.id, mode: 'info' }),
    );
    expect(dRead.ok).toBe(false);
    expect(dRead.observation).toContain('还没有可读取的 yield 结果');
    expect(dRead.observation).toContain('run_workflow');
    expect(dRead.observation).not.toContain('web_fetch');

    // returnToLLM:false（正常模式）不写缓存
    const fSkill = recipe({ id: 'demo.r2l.nocache.false', workflow: spec, returnToLLM: false });
    const fParts = buildWorkflowToolParts([fSkill], registry, undefined);
    await fParts.executors[RUN_WORKFLOW_TOOL_NAME]!(
      JSON.stringify({ skillId: fSkill.id }),
    );
    const fRead = await fParts.executors[WORKFLOW_RESULT_READ_TOOL_NAME]!(
      JSON.stringify({ resultId: fSkill.id, mode: 'info' }),
    );
    expect(fRead.ok).toBe(false);
    expect(fRead.observation).not.toContain('web_fetch');

    // 失败不写缓存
    const failSkill = recipe({ id: 'demo.r2l.nocache.fail', workflow: spec, returnToLLM: true });
    const failReg = fakeRegistry({
      fetch_data: () => ({ value: YIELD_VALUE }),
      normalize: () => { throw new Error('归一化失败'); },
    });
    const failParts = buildWorkflowToolParts([failSkill], failReg, undefined);
    const failWf = await failParts.executors[RUN_WORKFLOW_TOOL_NAME]!(
      JSON.stringify({ skillId: failSkill.id }),
    );
    expect(failWf.ok).toBe(false);
    const failRead = await failParts.executors[WORKFLOW_RESULT_READ_TOOL_NAME]!(
      JSON.stringify({ resultId: failSkill.id, mode: 'info' }),
    );
    expect(failRead.ok).toBe(false);
    expect(failRead.observation).not.toContain('web_fetch');
  });

  // ---- 分页读全集成断言（替换旧「单块裁剪」那条） ----

  it('⑦ 大 value → run_workflow → info → 反复 slice 按 offset 递增 → 拼回全文与 debugValue 相等', async () => {
    // 长度由既有上限推导，测试里不写死任何新阈值 / 分片数常量。
    const big = '弈'.repeat(CONTEXT_LIMITS.maxCharsPerMessage * 3);
    const bigReg = fakeRegistry({
      fetch_data: () => ({ value: { stats: big, marker: 'END-OF-VALUES' } }),
      normalize: () => ({ value: null }),
    });
    const skill = recipe({ id: 'demo.r2l.paging', workflow: spec, returnToLLM: true });
    const parts = buildWorkflowToolParts([skill], bigReg, undefined);

    const wf = await parts.executors[RUN_WORKFLOW_TOOL_NAME]!(
      JSON.stringify({ skillId: skill.id }),
    );
    expect(wf.ok).toBe(true);
    expect(wf.observation).not.toContain(big); // 观察不含数据本体
    expect(wf.observation.length).toBeLessThanOrEqual(CONTEXT_LIMITS.maxCharsPerMessage);

    // 原文 = 缓存文本：首行 + debugValue(values)
    const values = { fetch: { stats: big, marker: 'END-OF-VALUES' } };
    const fullText = `【yield 汇总 values】\n${JSON.stringify(values)}`;
    const total = fullText.length;

    const info = await parts.executors[WORKFLOW_RESULT_READ_TOOL_NAME]!(
      JSON.stringify({ resultId: skill.id, mode: 'info' }),
    );
    expect(info.ok).toBe(true);
    expect(info.preparatory).toBe(true);
    expect(info.observation).toContain(`${total} 字符`);

    // 反复 slice：按 footer 的「范围 [start, end)」取真实 body，按 end 递增 offset
    let offset = 0;
    let joined = '';
    let rounds = 0;
    let lastEnded = false;
    // 与 WebFetchCache.test.ts 同形的循环保险（不是分片数上限）；片数只打印、不作断言。
    while (rounds < 100) {
      const r = await parts.executors[WORKFLOW_RESULT_READ_TOOL_NAME]!(
        JSON.stringify({ resultId: skill.id, mode: 'slice', offset }),
      );
      rounds++;
      expect(r.ok).toBe(true);
      expect(r.preparatory).toBe(true);
      expect(r.observation.length).toBeLessThanOrEqual(CONTEXT_LIMITS.maxCharsPerMessage);
      const m = /本段起点 (\d+)，长度 (\d+)，范围 \[(\d+), (\d+)\)/.exec(r.observation);
      expect(m).not.toBeNull();
      const start = Number(m![1]);
      const end = Number(m![4]);
      const len = Number(m![2]);
      const footStart = r.observation.lastIndexOf('\n[本段起点');
      const headAndBody = r.observation.slice(0, footStart);
      const body = headAndBody.slice(headAndBody.length - len);
      expect(body).toBe(fullText.slice(start, end));
      joined += body;
      offset = end;
      if (r.observation.includes('已到正文末尾')) { lastEnded = true; break; }
      expect(r.observation).toContain('请把 offset 设为');
    }
    expect(lastEnded).toBe(true);
    expect(joined).toBe(fullText); // 逐字相等：读全，无遗漏无补写
    // 片数只作回执打印，不作断言上限（数据规模的自然结果）
    console.info(`[workflow_result_read] 分页读全 ${total} 字符用了 ${rounds} 片`);
  });

  // ---- 参数校验 / 空缓存友好提示 ----

  it('⑧ 空缓存友好提示（不含 web_fetch 字样）、非法 mode / 空 resultId 明确回执', async () => {
    const skill = recipe({ id: 'demo.r2l.validate', workflow: spec, returnToLLM: true });
    const parts = buildWorkflowToolParts([skill], registry, undefined);
    // 未跑 run_workflow 之前读 → 空缓存友好提示
    const empty = await parts.executors[WORKFLOW_RESULT_READ_TOOL_NAME]!(
      JSON.stringify({ resultId: skill.id, mode: 'info' }),
    );
    expect(empty.ok).toBe(false);
    expect(empty.preparatory).toBe(true);
    expect(empty.observation).toContain('还没有可读取的 yield 结果');
    expect(empty.observation).toContain('run_workflow');
    expect(empty.observation).not.toContain('web_fetch');

    const badModes: Array<[Record<string, unknown>, string]> = [
      [{ resultId: skill.id, mode: 'wat' }, 'mode 必须是'],
      [{ resultId: '', mode: 'info' }, '缺少 resultId'],
      [{ mode: 'info' }, '缺少 resultId'],
      [{ resultId: skill.id }, 'mode 必须是'],
    ];
    for (const [args, keyword] of badModes) {
      const r = await parts.executors[WORKFLOW_RESULT_READ_TOOL_NAME]!(JSON.stringify(args));
      expect(r.ok, JSON.stringify(args)).toBe(false);
      expect(r.preparatory, JSON.stringify(args)).toBe(true);
      expect(r.observation, JSON.stringify(args)).toContain(keyword);
      expect(r.observation, JSON.stringify(args)).not.toContain('web_fetch');
    }
    const badJson = await parts.executors[WORKFLOW_RESULT_READ_TOOL_NAME]!('{not json');
    expect(badJson.ok).toBe(false);
    expect(badJson.observation).toContain('不是合法 JSON');
    expect(badJson.preparatory).toBe(true);
  });

  it('⑨ 真实 85KB 级 value：能在默认 100 次 model call guard 内读全（片数只打印、不作断言上限）', async () => {
    // 构造契约「已实测事实」里的真实规模（85,323 字符）离线数据，不联网、不改任何默认业务参数。
    const targetChars = 85_323;
    const body = '弈'.repeat(targetChars);
    const realReg = fakeRegistry({
      fetch_data: () => ({ value: { nodes: body } }),
      normalize: () => ({ value: null }),
    });
    const skill = recipe({ id: 'demo.r2l.real85k', workflow: spec, returnToLLM: true });
    const parts = buildWorkflowToolParts([skill], realReg, undefined);
    const wf = await parts.executors[RUN_WORKFLOW_TOOL_NAME]!(
      JSON.stringify({ skillId: skill.id }),
    );
    expect(wf.ok).toBe(true);
    expect(wf.observation.length).toBeLessThanOrEqual(CONTEXT_LIMITS.maxCharsPerMessage);

    const fullText = `【yield 汇总 values】\n${JSON.stringify({ fetch: { nodes: body } })}`;
    let offset = 0;
    let joined = '';
    let reads = 0;
    while (reads < 100) {
      const r = await parts.executors[WORKFLOW_RESULT_READ_TOOL_NAME]!(
        JSON.stringify({ resultId: skill.id, mode: 'slice', offset }),
      );
      reads++;
      expect(r.preparatory).toBe(true);
      expect(r.observation.length).toBeLessThanOrEqual(CONTEXT_LIMITS.maxCharsPerMessage);
      const m = /本段起点 (\d+)，长度 (\d+)，范围 \[(\d+), (\d+)\)/.exec(r.observation);
      expect(m).not.toBeNull();
      const start = Number(m![1]);
      const end = Number(m![4]);
      const len = Number(m![2]);
      const footStart = r.observation.lastIndexOf('\n[本段起点');
      const headAndBody = r.observation.slice(0, footStart);
      joined += headAndBody.slice(headAndBody.length - len);
      offset = end;
      if (r.observation.includes('已到正文末尾')) break;
    }
    expect(joined).toBe(fullText);
    // ToolLoop 默认 guard：maxTurns=10、maxModelCalls=100；分页读取是同一轮内的
    // preparatory 延续，片数是数据规模的自然结果，不作断言上限，只作回执打印。
    const modelCalls = 1 + 1 + reads; // run_workflow + info + slice×N（含驱动分析的那轮由外层 loop 计）
    console.info(`[workflow_result_read] 85KB 级读全 ${fullText.length} 字符：slice ${reads} 片，参考 model calls ${modelCalls}`);
  });
});


// ---------- B3 声明式投影（llmProjection） ----------
/**
 * B3：宿主在写结果缓存前按配方 llmProjection.keep 做「声明式字段白名单 + 无损紧凑行」，
 * 缓存只放关系摘要；workflow_result_read 引擎 / 分页口径 / 静态工具定义一律不动。
 * 无 llmProjection 声明 = B2 全量（零回归）；!returnToLLM / debug / fail 三条路径逐字不变。
 */
describe('B3 声明式投影（llmProjection）', () => {
  const KEEP = ['stats', 'nodes', 'components', 'commonOpponents'];

  /** 与真实 circle.normalize 同形：yield 节点 value = 五大段，edges 逐边明细占大头。 */
  function circleValue(nodeCount: number) {
    const nodes = Array.from({ length: nodeCount }, (_, i) => ({
      uid: `u${i}`, name: `账号${i}`, degree: i + 1, gameCount: (i + 1) * 2,
    }));
    const components = Array.from({ length: nodeCount }, (_, i) => ({
      uid: `u${i}`, component: 0, size: nodeCount,
    }));
    const commonOpponents = Array.from({ length: nodeCount }, (_, i) => ({
      uid: `u${i}`, shared: (i + 1) * 3, opponents: [`o${i}`],
    }));
    const edges = Array.from({ length: nodeCount * 2 }, (_, i) => ({
      a: `u${i % nodeCount}`, b: `u${(i + 1) % nodeCount}`, games: 5,
    }));
    return {
      stats: { nodeCount, edgeCount: edges.length, componentCount: 1 },
      nodes, components, edges, commonOpponents,
    };
  }

  function circleSpec(): WorkflowSpec {
    return {
      steps: [
        { id: 'normalize', call: 'normalize', yield: true },
      ] as WorkflowStep[],
    };
  }

  function circleRegistry(value: unknown): OperatorRegistry {
    return fakeRegistry({ normalize: () => ({ value }) });
  }

  function projectionSkill(id: string, over: Partial<SkillRecipe> = {}): SkillRecipe {
    return recipe({
      id, workflow: circleSpec(), returnToLLM: true,
      llmProjection: { keep: [...KEEP] }, ...over,
    });
  }

  /** 与 WebFetchCache.test.ts / B2 既有断言同形：按 footer 的「范围 [start, end)」取真实 body。 */
  async function readAll(
    parts: ReturnType<typeof buildWorkflowToolParts>, skillId: string,
  ): Promise<{ joined: string; slices: number; total: number }> {
    const info = await parts.executors[WORKFLOW_RESULT_READ_TOOL_NAME]!(
      JSON.stringify({ resultId: skillId, mode: 'info' }),
    );
    expect(info.ok).toBe(true);
    expect(info.preparatory).toBe(true);
    const totalMatch = /缓存正文 (\d+) 字符/.exec(info.observation);
    expect(totalMatch).not.toBeNull();
    const total = Number(totalMatch![1]);
    let offset = 0;
    let joined = '';
    let slices = 0;
    let ended = false;
    // 与既有 ⑦/⑨ / WebFetchCache.test.ts 同形的循环保险（不是分片数上限）；片数只打印。
    while (slices < 100) {
      const r = await parts.executors[WORKFLOW_RESULT_READ_TOOL_NAME]!(
        JSON.stringify({ resultId: skillId, mode: 'slice', offset }),
      );
      slices++;
      expect(r.ok).toBe(true);
      expect(r.preparatory).toBe(true);
      expect(r.observation.length).toBeLessThanOrEqual(CONTEXT_LIMITS.maxCharsPerMessage);
      const m = /本段起点 (\d+)，长度 (\d+)，范围 \[(\d+), (\d+)\)/.exec(r.observation);
      expect(m).not.toBeNull();
      const start = Number(m![1]);
      const end = Number(m![4]);
      const len = Number(m![2]);
      const footStart = r.observation.lastIndexOf('\n[本段起点');
      const headAndBody = r.observation.slice(0, footStart);
      joined += headAndBody.slice(headAndBody.length - len);
      offset = end;
      if (r.observation.includes('已到正文末尾')) { ended = true; break; }
      expect(r.observation).toContain('请把 offset 设为');
    }
    expect(ended).toBe(true);
    return { joined, slices, total };
  }

  it('① 投影后 info 字符数 = 缓存文本长度（< 全量），slice 正文不含 edges、含四个保留段', async () => {
    const value = circleValue(20);
    const skill = projectionSkill('demo.b3.proj');
    const parts = buildWorkflowToolParts([skill], circleRegistry(value));
    const wf = await parts.executors[RUN_WORKFLOW_TOOL_NAME]!(
      JSON.stringify({ skillId: skill.id }),
    );
    expect(wf.ok).toBe(true);

    // 全量文本（B2 口径，逐字 = 既有实现）
    const fullText = `【yield 汇总 values】\n${JSON.stringify({ normalize: value })}`;
    // 观测里的「共 N 字符」不再等于全量长度（见 ②），info 的总量等于投影后缓存长度。
    const { joined, total } = await readAll(parts, skill.id);
    expect(total).toBeLessThan(fullText.length);
    expect(total).toBe(joined.length);
    // 逐字拼回 = 缓存正文；不含被 keep 排除的 edges 段，含四个保留段
    expect(joined.startsWith('【yield 汇总 values】\n')).toBe(true);
    const body = JSON.parse(joined.slice('【yield 汇总 values】\n'.length)) as Record<string, unknown>;
    const projected = body['normalize'] as Record<string, unknown>;
    expect(Object.keys(projected)).toEqual(KEEP); // 按 keep 顺序
    expect(projected).not.toHaveProperty('edges');
    for (const seg of KEEP) expect(projected).toHaveProperty(seg);
    expect(joined).not.toContain('"edges"');
    for (const seg of KEEP) expect(joined).toContain(`"${seg}"`);
  });

  it('② 观察里的「共 N 字符」= 缓存长度（不是全量 debugValue(result.values) 长度）', async () => {
    const value = circleValue(20);
    const skill = projectionSkill('demo.b3.len');
    const parts = buildWorkflowToolParts([skill], circleRegistry(value));
    const wf = await parts.executors[RUN_WORKFLOW_TOOL_NAME]!(
      JSON.stringify({ skillId: skill.id }),
    );
    const fullText = `【yield 汇总 values】\n${JSON.stringify({ normalize: value })}`;
    const { total } = await readAll(parts, skill.id);
    // 措辞只改「全文」→「视图」，其余指路文案逐字保留
    expect(wf.observation).toContain(`yield 汇总视图共 ${total} 字符`);
    expect(wf.observation).not.toContain('yield 汇总全文共');
    expect(wf.observation).not.toContain(`${fullText.length} 字符`);
    expect(total).not.toBe(fullText.length);
    expect(wf.observation).toContain('resultId');
    expect(wf.observation).toContain('"mode":"info"');
    expect(wf.observation).toContain('offset:0');
    expect(wf.observation).toContain('请把 offset 设为 X 继续读');
    expect(wf.observation).toContain('已到正文末尾');
    expect(wf.observation).toContain('读全后再做关系分析');
    expect(wf.observation).toContain('不要编造');
    expect(wf.observation.length).toBeLessThanOrEqual(CONTEXT_LIMITS.maxCharsPerMessage);
  });

  it('③ 保留段无损：columns/rows 能逐字还原成原对象数组；keep 排除的段不出现', async () => {
    const nodes = [
      { uid: 'u1', name: '甲', degree: 2, gameCount: 3 },
      { uid: 'u2', name: '乙', degree: 4, gameCount: 7 },
      { uid: 'u3', name: '丙', degree: 1, gameCount: 1 },
    ];
    const edges = [{ a: 'u1', b: 'u2', games: 5 }];
    // 元素键集合不一致的数组：compactLlmValue 必须原样返回，不丢信息。
    const mixed = [{ x: 1 }, { y: 2 }];
    const value = {
      stats: { nodeCount: 3 },
      nodes,
      components: [{ uid: 'u1', component: 0, size: 3 }],
      edges,
      commonOpponents: [{ uid: 'u1', shared: 2, opponents: ['o1'] }],
      mixed,
    };
    const skill = projectionSkill('demo.b3.lossless', {
      llmProjection: { keep: ['stats', 'nodes', 'components', 'commonOpponents', 'mixed'] },
    });
    const parts = buildWorkflowToolParts([skill], circleRegistry(value));
    await parts.executors[RUN_WORKFLOW_TOOL_NAME]!(JSON.stringify({ skillId: skill.id }));
    const { joined } = await readAll(parts, skill.id);
    const body = JSON.parse(joined.slice('【yield 汇总 values】\n'.length)) as Record<string, unknown>;
    const p = body['normalize'] as Record<string, unknown>;

    // 通用紧凑行：列名从 Object.keys(v[0]) 推导，不硬编码字段名
    const compact = p['nodes'] as { columns: string[]; rows: unknown[][] };
    expect(compact.columns).toEqual(Object.keys(nodes[0]!)); // ['uid','name','degree','gameCount']
    expect(compact.rows).toHaveLength(nodes.length);
    const restored = compact.rows.map((row) => Object.fromEntries(
      compact.columns.map((c, i): [string, unknown] => [c, row[i]]),
    ));
    expect(restored).toEqual(nodes); // 逐字还原
    // 被 keep 排除的段（含 edges 逐边明细）一个字都不出现
    expect(p).not.toHaveProperty('edges');
    expect(joined).not.toContain('"edges"');
    expect(joined).not.toContain('"a"');
    // 非同构对象数组（键集合不一致）一律原样返回（不丢信息、不重编码）
    expect(p['mixed']).toEqual(mixed);
    expect(Array.isArray(p['mixed'])).toBe(true);
    expect(p['mixed']).not.toHaveProperty('columns');
  });

  it('④ 全量账号保留：nodes.rows.length = 原 nodes.length（无「前 N 条」截断）', async () => {
    const nodeCount = 199; // 契约已实测事实：本地 circle.normalize 的 nodes 条数，不是阈值
    const value = circleValue(nodeCount);
    const skill = projectionSkill('demo.b3.allaccounts');
    const parts = buildWorkflowToolParts([skill], circleRegistry(value));
    await parts.executors[RUN_WORKFLOW_TOOL_NAME]!(JSON.stringify({ skillId: skill.id }));
    const { joined } = await readAll(parts, skill.id);
    const body = JSON.parse(joined.slice('【yield 汇总 values】\n'.length)) as Record<string, unknown>;
    const p = body['normalize'] as Record<string, unknown>;
    const nodesCompact = p['nodes'] as { columns: string[]; rows: unknown[][] };
    expect(nodesCompact.rows.length).toBe(value.nodes.length);
    expect(nodesCompact.rows.length).toBe(nodeCount);
    const coCompact = p['commonOpponents'] as { columns: string[]; rows: unknown[][] };
    expect(coCompact.rows.length).toBe(value.commonOpponents.length);
    // 最后一个账号仍逐字在（没被「取前 N 条」砍掉）
    expect(nodesCompact.rows[nodesCompact.rows.length - 1]).toEqual(
      Object.values(value.nodes[value.nodes.length - 1]!),
    );
  });

  it('⑤ 无 llmProjection 的 returnToLLM:true 技能 = B2 全量（缓存文本逐字相等，零回归）', async () => {
    const value = circleValue(20);
    const skill = recipe({
      id: 'demo.b3.noproj', workflow: circleSpec(), returnToLLM: true,
    });
    expect(skill.llmProjection).toBeUndefined();
    const parts = buildWorkflowToolParts([skill], circleRegistry(value));
    const wf = await parts.executors[RUN_WORKFLOW_TOOL_NAME]!(JSON.stringify({ skillId: skill.id }));
    const { joined, total } = await readAll(parts, skill.id);
    const fullText = `【yield 汇总 values】\n${JSON.stringify({ normalize: value })}`;
    expect(joined).toBe(fullText); // 逐字相等：无声明不投影
    expect(total).toBe(fullText.length);
    // 观察措辞仅为「全文」→「视图」这一处声明变更，N 仍是全量长度
    expect(wf.observation).toContain(`yield 汇总视图共 ${fullText.length} 字符`);
    expect(wf.observation).not.toContain('yield 汇总全文共');
  });

  it('⑥ 2x 规模分页性质：投影后文本反复 slice 拼回逐字相等、每片 ≤ 上限、preparatory===true', async () => {
    // 2x 账号规模（契约实测投影约 19,708 字符级），长度由既有上限推导，不写死分片数。
    const nodeCount = 398; // 数据规模 = 2 × 199，不是阈值 / 分片数
    const value = circleValue(nodeCount);
    const skill = projectionSkill('demo.b3.paging2x');
    const parts = buildWorkflowToolParts([skill], circleRegistry(value));
    const wf = await parts.executors[RUN_WORKFLOW_TOOL_NAME]!(JSON.stringify({ skillId: skill.id }));
    expect(wf.ok).toBe(true);
    const { joined, slices, total } = await readAll(parts, skill.id);
    expect(joined.length).toBe(total);
    expect(joined.startsWith('【yield 汇总 values】\n')).toBe(true);
    // 拼回的就是缓存正文（逐字相等由 readAll 的 body 提取 + 上面长度一致保证）
    const body = JSON.parse(joined.slice('【yield 汇总 values】\n'.length)) as Record<string, unknown>;
    const p = body['normalize'] as Record<string, unknown>;
    expect(Object.keys(p)).toEqual(KEEP);
    expect(p).not.toHaveProperty('edges');
    // 片数只打印、不作断言上限（数据规模的自然结果）
    console.info(`[B3 投影] 2x 规模缓存 ${total} 字符，slice 读全用了 ${slices} 片`);
  });

  it('⑦ 加了 llmProjection 字段也不影响 !returnToLLM / debug / fail 三条默认路径', async () => {
    const value = circleValue(8);
    const registry = circleRegistry(value);
    // !returnToLLM（缺省）+ 带 llmProjection：观察仍是「完成 + 句柄」，不写缓存
    const off = recipe({
      id: 'demo.b3.off', workflow: circleSpec(),
      llmProjection: { keep: [...KEEP] },
    });
    const offParts = buildWorkflowToolParts([off], registry);
    const offOutcome = await offParts.executors[RUN_WORKFLOW_TOOL_NAME]!(
      JSON.stringify({ skillId: off.id }),
    );
    expect(offOutcome.ok).toBe(true);
    expect(offOutcome.observation).toContain('结果位置（句柄）');
    expect(offOutcome.observation).toContain('请如实告知用户任务已完成');
    expect(offOutcome.observation).not.toContain('yield 汇总视图共');
    expect(offOutcome.observation).not.toContain('【yield 汇总 values】');
    const offRead = await offParts.executors[WORKFLOW_RESULT_READ_TOOL_NAME]!(
      JSON.stringify({ resultId: off.id, mode: 'info' }),
    );
    expect(offRead.ok).toBe(false); // !returnToLLM 不写缓存

    // debug:true 分支不写缓存，观察是「调试模式」而非成功观察
    const dbgSkill = projectionSkill('demo.b3.dbg');
    const dbgParts = buildWorkflowToolParts([dbgSkill], registry, undefined, true);
    const dbgOutcome = await dbgParts.executors[RUN_WORKFLOW_TOOL_NAME]!(
      JSON.stringify({ skillId: dbgSkill.id, debug: true }),
    );
    expect(dbgOutcome.observation).toContain('调试模式');
    expect(dbgOutcome.observation).not.toContain('yield 汇总视图共');
    const dbgRead = await dbgParts.executors[WORKFLOW_RESULT_READ_TOOL_NAME]!(
      JSON.stringify({ resultId: dbgSkill.id, mode: 'info' }),
    );
    expect(dbgRead.ok).toBe(false);

    // fail 分支：观察是结构化失败文本，不含业务 value、不写缓存
    const failSkill = projectionSkill('demo.b3.fail');
    const failReg = fakeRegistry({
      normalize: () => { throw new Error('归一化失败'); },
    });
    const failParts = buildWorkflowToolParts([failSkill], failReg);
    const failOutcome = await failParts.executors[RUN_WORKFLOW_TOOL_NAME]!(
      JSON.stringify({ skillId: failSkill.id }),
    );
    expect(failOutcome.ok).toBe(false);
    expect(failOutcome.observation).toContain('workflow 执行失败');
    expect(failOutcome.observation).toContain('归一化失败');
    expect(failOutcome.observation).not.toContain('yield 汇总视图共');
    expect(failOutcome.observation).not.toContain('账号0');
    const failRead = await failParts.executors[WORKFLOW_RESULT_READ_TOOL_NAME]!(
      JSON.stringify({ resultId: failSkill.id, mode: 'info' }),
    );
    expect(failRead.ok).toBe(false);
  });
});
