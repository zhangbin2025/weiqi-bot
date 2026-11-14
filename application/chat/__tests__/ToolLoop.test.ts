/**
 * 通用 ToolLoop 契约测试
 *
 * chat / plugin 两个角色共用的唯一循环。锁住：
 * - 决策 → tool_calls → 观察回填 → 再决策 → 收敛
 * - 未知工具 / 执行器抛错都变观察，不让 loop 崩
 * - 动态 systemPrompt 替换 messages[0]
 * - 多模态 part 追加独立 user 消息、附件回收
 * - 观察按 CONTEXT_LIMITS 裁剪；轮数上限沿用 DEFAULT_PLUGIN_MAX_ATTEMPTS + 1
 */

import { describe, it, expect, vi } from 'vitest';
import { runToolLoop, type ToolKit } from '../ToolLoop';
import { CONTEXT_LIMITS } from '../ConversationPrompt';
import { DEFAULT_PLUGIN_MAX_ATTEMPTS } from '../../plugin/PluginConfig';
import type { IModelGateway, ModelResult, ModelMessage } from '../../model/IModelGateway';

function gatewayWith(steps: ModelResult[]): IModelGateway & { calls: unknown[] } {
  const calls: unknown[] = [];
  let i = 0;
  return {
    calls,
    isReady: () => true,
    execute: vi.fn(async (req: unknown) => {
      calls.push(req);
      return steps[Math.min(i++, steps.length - 1)]!;
    }),
  } as unknown as IModelGateway & { calls: unknown[] };
}

const baseMessages = (): ModelMessage[] => [
  { role: 'system', content: '原始 system' },
  { role: 'user', content: '做点事' },
];

const echoKit = (overrides: Partial<ToolKit> = {}): ToolKit => ({
  tools: [
    { name: 'echo', description: '回显', parameters: { type: 'object', properties: { text: { type: 'string' } } } },
  ],
  executors: {
    echo: async (argsJson: string) => {
      const { text } = JSON.parse(argsJson) as { text?: string };
      return { observation: `观察到：${text ?? ''}`, ok: true, detail: `回显 ${text ?? ''}` };
    },
  },
  ...overrides,
});

describe('runToolLoop 基本循环', () => {
  it('无 tool_calls：一次决策直接收敛', async () => {
    const gw = gatewayWith([{ text: '你好', truncated: false }]);
    const r = await runToolLoop(
      { gateway: gw, ...echoKit(), source: 'plugin' },
      { messages: baseMessages() },
    );
    expect(r.reply).toBe('你好');
    expect(r.turns).toBe(1);
    expect(r.exhausted).toBe(false);
    expect(r.trace.map((s) => s.phase)).toEqual(['decision', 'final']);
    expect(r.trace[0]!.source).toBe('plugin');
  });

  it('tool_calls → tool 观察回填（tool_call_id 对齐）→ 再决策给最终文本', async () => {
    const gw = gatewayWith([
      {
        text: '', truncated: false,
        toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"text":"甲"}' }],
      },
      { text: '完成', truncated: false },
    ]);
    const r = await runToolLoop(
      { gateway: gw, ...echoKit(), source: 'web' },
      { messages: baseMessages() },
    );
    expect(r.reply).toBe('完成');
    expect(r.turns).toBe(2);
    const second = gw.calls[1] as { messages: ModelMessage[] };
    const tail = second.messages.slice(-2);
    expect(tail[0]!.role).toBe('assistant');
    expect((tail[0] as { tool_calls?: unknown[] }).tool_calls).toHaveLength(1);
    expect(tail[1]!.role).toBe('tool');
    expect((tail[1] as { tool_call_id?: string }).tool_call_id).toBe('c1');
    expect(tail[1]!.content).toContain('观察到：甲');
    // 原始历史不污染
    expect(second.messages[0]).toEqual(baseMessages()[0]);
    expect(second.messages[1]).toEqual(baseMessages()[1]);
  });

  it('每轮都带 tools 声明，决策权在模型', async () => {
    const gw = gatewayWith([{ text: 'ok', truncated: false }]);
    const kit = echoKit();
    await runToolLoop({ gateway: gw, ...kit, source: 'plugin' }, { messages: baseMessages() });
    expect((gw.calls[0] as { tools: { name: string }[] }).tools.map((t) => t.name)).toEqual(['echo']);
  });

  it('未知工具名 → 观察告知可用工具，loop 继续', async () => {
    const gw = gatewayWith([
      { text: '', truncated: false, toolCalls: [{ id: 'c', name: 'nope', arguments: '{}' }] },
      { text: '改用正确工具', truncated: false },
    ]);
    const r = await runToolLoop(
      { gateway: gw, ...echoKit(), source: 'plugin' },
      { messages: baseMessages() },
    );
    const second = gw.calls[1] as { messages: ModelMessage[] };
    expect(String(second.messages.at(-1)!.content)).toContain('未知工具');
    expect(r.reply).toBe('改用正确工具');
  });

  it('执行器抛错 → 变成失败观察，不让 loop 崩', async () => {
    const gw = gatewayWith([
      { text: '', truncated: false, toolCalls: [{ id: 'c', name: 'echo', arguments: '{}' }] },
      { text: '仍给出回复', truncated: false },
    ]);
    const kit = echoKit({ executors: { echo: async () => { throw new Error('炸了'); } } });
    const r = await runToolLoop({ gateway: gw, ...kit, source: 'plugin' }, { messages: baseMessages() });
    expect(r.reply).toBe('仍给出回复');
    expect(r.trace.some((s) => s.phase === 'observe' && !s.ok)).toBe(true);
    const second = gw.calls[1] as { messages: ModelMessage[] };
    expect(String(second.messages.at(-1)!.content)).toContain('执行异常：炸了');
  });

  it('模型调用失败 → 明确回复 + 末步 ok=false', async () => {
    const gw = {
      isReady: () => true,
      execute: vi.fn(async () => { throw new Error('超时'); }),
    } as unknown as IModelGateway;
    const r = await runToolLoop(
      { gateway: gw, ...echoKit(), source: 'plugin' },
      { messages: baseMessages() },
    );
    expect(r.reply).toContain('模型调用失败：超时');
    expect(r.trace.at(-1)!.ok).toBe(false);
  });

  it('轮数上限沿用 DEFAULT_PLUGIN_MAX_ATTEMPTS+1，用尽标 exhausted', async () => {
    const always: ModelResult = {
      text: '', truncated: false,
      toolCalls: [{ id: 'c', name: 'echo', arguments: '{"text":"x"}' }],
    };
    const gw = gatewayWith([always]);
    const r = await runToolLoop(
      { gateway: gw, ...echoKit(), source: 'plugin' },
      { messages: baseMessages() },
    );
    expect(r.turns).toBe(DEFAULT_PLUGIN_MAX_ATTEMPTS + 1);
    expect(r.exhausted).toBe(true);
    expect(r.reply).toContain('最大决策次数');
  });

  it('显式 maxTurns 覆盖默认值', async () => {
    const always: ModelResult = {
      text: '', truncated: false,
      toolCalls: [{ id: 'c', name: 'echo', arguments: '{"text":"x"}' }],
    };
    const gw = gatewayWith([always]);
    const r = await runToolLoop(
      { gateway: gw, ...echoKit(), source: 'plugin', maxTurns: 2 },
      { messages: baseMessages() },
    );
    expect(r.turns).toBe(2);
    expect(gw.calls).toHaveLength(2);
  });
});

describe('runToolLoop system / 多模态 / 裁剪', () => {
  it('动态 systemPrompt 替换 messages[0]，每次 turn 都能拿最新值', async () => {
    const gw = gatewayWith([{ text: 'ok', truncated: false }]);
    let n = 0;
    const kit = echoKit({ systemPrompt: () => Promise.resolve(`动态 system ${++n}`) });
    await runToolLoop({ gateway: gw, ...kit, source: 'plugin' }, { messages: baseMessages() });
    const req = gw.calls[0] as { messages: ModelMessage[] };
    expect(req.messages[0]).toEqual({ role: 'system', content: '动态 system 1' });
  });

  it('没有 system 时补一条 system，不丢原有消息', async () => {
    const gw = gatewayWith([{ text: 'ok', truncated: false }]);
    await runToolLoop(
      {
        gateway: gw, ...echoKit({ systemPrompt: '补充的 system' }), source: 'plugin',
      },
      { messages: [{ role: 'user', content: '只有用户' }] },
    );
    const req = gw.calls[0] as { messages: ModelMessage[] };
    expect(req.messages[0]).toEqual({ role: 'system', content: '补充的 system' });
    expect(req.messages[1]).toEqual({ role: 'user', content: '只有用户' });
  });

  it('工具产出 parts → 追加独立多模态 user 消息，附件回收', async () => {
    const gw = gatewayWith([
      {
        text: '', truncated: false,
        toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"text":"图"}' }],
      },
      { text: '看到了', truncated: false },
    ]);
    const kit = echoKit({
      executors: {
        echo: async () => ({
          observation: '读到图片', ok: true, detail: '回显图片',
          parts: [{ type: 'image', uri: 'data:image/png;base64,AAAA' }],
          attachment: {
            kind: 'image', label: 'a.png', mimeType: 'image/png',
            dataUri: 'data:image/png;base64,AAAA',
          },
        }),
      },
    });
    const r = await runToolLoop({ gateway: gw, ...kit, source: 'web' }, { messages: baseMessages() });
    const second = gw.calls[1] as { messages: ModelMessage[] };
    const appended = second.messages.at(-1)!;
    expect(appended.role).toBe('user');
    expect(Array.isArray(appended.content)).toBe(true);
    const parts = appended.content as Array<{ type: string }>;
    expect(parts[0]!.type).toBe('text');
    expect(parts[1]!.type).toBe('image');
    expect(r.attachments).toHaveLength(1);
    expect(r.attachments[0]!.kind).toBe('image');
  });

  it('超长观察按 maxCharsPerMessage 裁剪并给可见提示', async () => {
    const big = 'x'.repeat(CONTEXT_LIMITS.maxCharsPerMessage + 5000);
    const gw = gatewayWith([
      {
        text: '', truncated: false,
        toolCalls: [{ id: 'c', name: 'echo', arguments: '{}' }],
      },
      { text: 'done', truncated: false },
    ]);
    const kit = echoKit({
      executors: { echo: async () => ({ observation: big, ok: true, detail: '长观察' }) },
    });
    await runToolLoop({ gateway: gw, ...kit, source: 'plugin' }, { messages: baseMessages() });
    const second = gw.calls[1] as { messages: ModelMessage[] };
    const observation = String(second.messages.at(-1)!.content);
    expect(observation.length).toBeLessThanOrEqual(CONTEXT_LIMITS.maxCharsPerMessage);
    expect(observation).toContain('已截断');
  });
});


describe('runToolLoop 修复延续（2026-11-14：两个预算不再合并）', () => {
  /** 前 fails 轮都提交源码且验收失败，最后一轮给最终文本 */
  const writeThenFinal = (fails: number): ModelResult[] => {
    const steps: ModelResult[] = [];
    for (let i = 0; i < fails; i++) {
      steps.push({
        text: '', truncated: false,
        toolCalls: [{ id: `c${i}`, name: 'plugin_write', arguments: '{"code":"x"}' }],
      });
    }
    steps.push({ text: '终于改对了', truncated: false });
    return steps;
  };

  /** 模拟插件工具集：每次提交都过不了确定性验收 */
  const repairKit = (): ToolKit => ({
    tools: [{ name: 'plugin_write', description: '提交源码', parameters: { type: 'object' } }],
    executors: {
      plugin_write: async () => ({
        observation: '输出不符合契约：缺少 score', ok: false,
        detail: '试算失败', repairable: true,
      }),
    },
  });

  it('确定性验收失败不占决策预算：连续失败后仍能收敛', async () => {
    const gw = gatewayWith(writeThenFinal(DEFAULT_PLUGIN_MAX_ATTEMPTS - 1));
    const r = await runToolLoop(
      { gateway: gw, ...repairKit(), source: 'plugin' },
      { messages: baseMessages() },
    );
    expect(r.reply).toBe('终于改对了');
    expect(r.exhausted).toBe(false);
    // 失败轮全部豁免，只有最后收敛那次算自主决策
    expect(r.turns).toBe(1);
  });

  it('连续失败不再被「连续延续封顶」误杀，只由总调用轮数 guard 兜底', async () => {
    const always: ModelResult = {
      text: '', truncated: false,
      toolCalls: [{ id: 'c', name: 'plugin_write', arguments: '{"code":"x"}' }],
    };
    const gw = gatewayWith([always]);
    const r = await runToolLoop(
      { gateway: gw, ...repairKit(), source: 'plugin' },
      { messages: baseMessages() },
    );
    expect(r.exhausted).toBe(true);
    expect(r.reply).toContain('总调用轮数上限');
    expect(r.reply).toContain('/llm repairs');
    expect(r.reply).not.toContain('最大决策次数');
    expect(r.reply).not.toContain('未推进到实质操作');
    const maxTurns = DEFAULT_PLUGIN_MAX_ATTEMPTS + 1;
    expect(gw.calls).toHaveLength(maxTurns * maxTurns);
  });

  it('未置位 repairable 的工具（chat/web 角色）行为完全不变', async () => {
    const always: ModelResult = {
      text: '', truncated: false,
      toolCalls: [{ id: 'c', name: 'echo', arguments: '{"text":"x"}' }],
    };
    const gw = gatewayWith([always]);
    const r = await runToolLoop(
      { gateway: gw, ...echoKit(), source: 'web' },
      { messages: baseMessages() },
    );
    expect(r.turns).toBe(DEFAULT_PLUGIN_MAX_ATTEMPTS + 1);
    expect(r.reply).toContain('最大决策次数');
  });
});


describe('runToolLoop 只读准备不占决策（2026-11-14：细粒度工具配粗粒度预算的修正）', () => {
  /** 只读工具每次都带 preparatory；状态变更工具不带 */
  const prepKit = (): ToolKit => ({
    tools: [
      { name: 'lookup', description: '只读查询', parameters: { type: 'object' } },
      { name: 'commit', description: '状态变更', parameters: { type: 'object' } },
    ],
    executors: {
      lookup: async () => ({ observation: '查到了', ok: true, detail: '只读查询', preparatory: true }),
      commit: async () => ({ observation: '已改', ok: true, detail: '状态变更' }),
    },
  });
  const step = (id: string, name: string): ModelResult => ({
    text: '', truncated: false,
    toolCalls: [{ id, name, arguments: '{}' }],
  });

  it('多步只读 + 状态变更 + 收敛：不再撞满决策上限', async () => {
    // 旧口径下这 4 次工具往返各计一次决策 → 正好撞满 4 次、拿不到最终答复；
    // 新口径下 2 次只读是延续、不计数，只有 2 次状态变更计决策。
    const gw = gatewayWith([
      step('c1', 'lookup'), step('c2', 'lookup'),
      step('c3', 'commit'), step('c4', 'commit'),
      { text: '总分插件已修订并启用', truncated: false },
    ]);
    const r = await runToolLoop(
      { gateway: gw, ...prepKit(), source: 'plugin' },
      { messages: baseMessages() },
    );
    expect(r.exhausted).toBe(false);
    expect(r.reply).toBe('总分插件已修订并启用');
    expect(r.turns).toBe(3); // 2 次状态变更 + 收敛那次
  });

  it('连续只读准备不误杀：debug×3 全成功后仍能正常收敛（用户实测 trace 回归）', async () => {
    // 2026-11-15 用户贴的过程：list ✓ → write ✓ → debug×3 ✓ → 却报「最终失败」。
    // 旧版「连续延续封顶」在第 3 次 debug 就强停，模型没机会给最终答复。
    const gw = gatewayWith([
      step('c1', 'lookup'), step('c2', 'lookup'), step('c3', 'lookup'), step('c4', 'lookup'),
      { text: '验算都通过了，插件已建好', truncated: false },
    ]);
    const r = await runToolLoop(
      { gateway: gw, ...prepKit(), source: 'plugin' },
      { messages: baseMessages() },
    );
    expect(r.exhausted).toBe(false);
    expect(r.reply).toBe('验算都通过了，插件已建好');
    expect(r.turns).toBe(1); // 全是延续，一次实质动作都没有；收敛那次算第 1 个决策编号
    expect(gw.calls).toHaveLength(5);
  });

  it('修复与只读交替不误杀：收敛前不再被连续计数强停', async () => {
    const mixed: ToolKit = {
      tools: [
        { name: 'lookup', description: '只读', parameters: { type: 'object' } },
        { name: 'submit', description: '提交', parameters: { type: 'object' } },
      ],
      executors: {
        lookup: async () => ({ observation: '查', ok: true, detail: '只读', preparatory: true }),
        submit: async () => ({ observation: '不合格', ok: false, detail: '试算失败', repairable: true }),
      },
    };
    const gw = gatewayWith([
      step('c1', 'submit'), step('c2', 'lookup'),
      step('c3', 'submit'), step('c4', 'lookup'),
      { text: '终于改对了', truncated: false },
    ]);
    const r = await runToolLoop(
      { gateway: gw, ...mixed, source: 'plugin' },
      { messages: baseMessages() },
    );
    expect(r.exhausted).toBe(false);
    expect(r.reply).toBe('终于改对了');
    expect(r.turns).toBe(1);
    expect(gw.calls).toHaveLength(5);
  });

  it('未置位任何标记的工具（chat/web 角色）仍逐轮计决策，行为完全不变', async () => {
    const gw = gatewayWith([step('c', 'commit')]);
    const r = await runToolLoop(
      { gateway: gw, ...prepKit(), source: 'web' },
      { messages: baseMessages() },
    );
    expect(r.turns).toBe(DEFAULT_PLUGIN_MAX_ATTEMPTS + 1);
    expect(r.exhausted).toBe(true);
    expect(r.reply).toContain('最大决策次数');
  });
});


describe('runToolLoop 总调用轮数 guard（2026-11-15：删掉连续延续封顶后的唯一兜底）', () => {
  const alwaysPrep: ToolKit = {
    tools: [{ name: 'lookup', description: '只读', parameters: { type: 'object' } }],
    executors: {
      lookup: async () => ({ observation: '查', ok: true, detail: '只读', preparatory: true }),
    },
  };
  const callStep = (): ModelResult => ({
    text: '', truncated: false,
    toolCalls: [{ id: 'c', name: 'lookup', arguments: '{}' }],
  });

  it('纯只读无限循环 → 总调用轮数 guard 到顶，如实报「总调用轮数上限」', async () => {
    const gw = gatewayWith([callStep()]);
    const r = await runToolLoop(
      { gateway: gw, ...alwaysPrep, source: 'plugin' },
      { messages: baseMessages() },
    );
    const maxTurns = DEFAULT_PLUGIN_MAX_ATTEMPTS + 1;
    expect(r.exhausted).toBe(true);
    expect(r.reply).toContain('总调用轮数上限');
    expect(r.reply).toContain('/llm repairs');
    expect(r.reply).not.toContain('最大决策次数');
    expect(r.reply).not.toContain('未推进到实质操作');
    expect(r.reply).not.toContain('试算未通过');
    expect(gw.calls).toHaveLength(maxTurns * maxTurns);
  });

  it('未置位任何标记的工具（chat/web）仍逐轮计决策，行为完全不变', async () => {
    const gw = gatewayWith([{
      text: '', truncated: false,
      toolCalls: [{ id: 'c', name: 'echo', arguments: '{"text":"x"}' }],
    }]);
    const r = await runToolLoop(
      { gateway: gw, ...echoKit(), source: 'web' },
      { messages: baseMessages() },
    );
    expect(r.turns).toBe(DEFAULT_PLUGIN_MAX_ATTEMPTS + 1);
    expect(r.exhausted).toBe(true);
    expect(r.reply).toContain('最大决策次数');
  });

  it('实质动作达 maxTurns 仍报最大决策次数（不受 guard 影响）', async () => {
    const gw = gatewayWith([{
      text: '', truncated: false,
      toolCalls: [{ id: 'c', name: 'echo', arguments: '{"text":"x"}' }],
    }]);
    const r = await runToolLoop(
      { gateway: gw, ...echoKit(), source: 'plugin' },
      { messages: baseMessages() },
    );
    expect(r.turns).toBe(DEFAULT_PLUGIN_MAX_ATTEMPTS + 1);
    expect(r.exhausted).toBe(true);
    expect(r.reply).toContain('最大决策次数');
  });
});
