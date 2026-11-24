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
 * 纯内存假 registry，不依赖 QuickJS / 网络 / DOM。
 */

import { describe, it, expect } from 'vitest';
import type { PluginTraceStep, StepResult, OperatorSpec } from '@domain/plugin/types';
import type { OperatorRegistry } from '@application/plugin/OperatorRegistry';
import type { SkillRecipe, WorkflowSpec, WorkflowStep } from '../SkillTypes';
import { buildWorkflowToolParts, RUN_WORKFLOW_TOOL_NAME } from '../WorkflowTool';

/** 与 WorkflowRunner.test.ts 同形的内存假算子表。 */
function fakeRegistry(
  ops: Record<string, (args: Record<string, unknown>) => StepResult | Promise<StepResult>>,
): OperatorRegistry {
  const specs = new Map<string, OperatorSpec>();
  for (const [name, fn] of Object.entries(ops)) {
    specs.set(name, { name, idempotent: true, run: async (args) => fn(args) });
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
) {
  const parts = buildWorkflowToolParts(active, registry, (_s: PluginTraceStep) => undefined);
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
    });

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
    });
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
  it('dev + 只有散文配方：仍挂 run_workflow，skillId enum 含该散文技能', () => {
    const parts = buildWorkflowToolParts(
      [recipe({ id: 'user.baidu.hot', name: '百度热搜' })],
      fakeRegistry({}),
      undefined,
      true,
    );
    expect(parts.tools.map((t) => t.name)).toEqual([RUN_WORKFLOW_TOOL_NAME]);
    const def = parts.tools[0]!;
    const props = (def.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    expect(props['debug']).toBeDefined();
    expect((props['skillId'] as { enum?: string[] }).enum).toContain('user.baidu.hot');
    expect(def.description).toContain('当前没有带 workflow 声明的技能');
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
