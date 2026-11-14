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
