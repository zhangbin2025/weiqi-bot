/**
 * 标准 tool-calling agent loop 契约测试
 * 锁住：决策 → 工具 → 观察回填 → 再决策 → 收敛，以及轮数上限、历史隔离。
 */
import { describe, it, expect, vi } from 'vitest';
import { runWebToolLoop, type WebTraceStep } from '../WebToolLoop';
import { DEFAULT_PLUGIN_MAX_ATTEMPTS } from '../../plugin/PluginConfig';
import { WEB_FETCH_TOOL_NAME } from '../WebFetchTool';
import { WEB_READ_PDF_TOOL_NAME, WEB_READ_IMAGE_TOOL_NAME } from '../WebResourceTools';
import type { IModelGateway, ModelResult } from '../../model/IModelGateway';

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

const toolDeps = () => ({
  proxyUrl: 'https://api.weiqi.lol',
  timeoutMs: 60_000,
  fetchImpl: vi.fn(async () => ({
    ok: true, status: 200, statusText: 'OK',
    headers: new Headers({ 'content-type': 'text/html' }),
    text: async () => '<html>柯洁九段</html>',
  })) as unknown as typeof fetch,
});

const baseMessages = () => [
  { role: 'system' as const, content: '你是助手' },
  { role: 'user' as const, content: '归纳 https://example.com/ 这个网页' },
];

describe('runWebToolLoop', () => {
  it('无 tool_calls：一次决策直接收敛，不访问网络', async () => {
    const gw = gatewayWith([{ text: '你好', truncated: false }]);
    const r = await runWebToolLoop({ gateway: gw, toolDeps: toolDeps() }, { messages: baseMessages() });
    expect(r.reply).toBe('你好');
    expect(r.turns).toBe(1);
    expect(r.exhausted).toBe(false);
    expect(r.trace.map((s) => s.phase)).toEqual(['decision', 'final']);
  });

  it('标准循环：tool_calls → tool 观察回填 → 再决策给最终文本', async () => {
    const gw = gatewayWith([
      {
        text: '', truncated: false,
        toolCalls: [{ id: 'c1', name: WEB_FETCH_TOOL_NAME, arguments: '{"url":"https://example.com/"}' }],
      },
      { text: '这个网页讲的是柯洁九段。来源：https://example.com/', truncated: false },
    ]);
    const r = await runWebToolLoop({ gateway: gw, toolDeps: toolDeps() }, { messages: baseMessages() });
    expect(r.reply).toContain('柯洁九段');
    expect(r.turns).toBe(2);
    expect(r.exhausted).toBe(false);

    // 第 2 次决策的 messages 里必须有 assistant(tool_calls) + tool 观察，且顺序正确
    const second = gw.calls[1] as { messages: Array<{ role: string; tool_calls?: unknown[]; tool_call_id?: string }> };
    const tail = second.messages.slice(-2);
    expect(tail[0]!.role).toBe('assistant');
    expect(tail[0]!.tool_calls).toHaveLength(1);
    expect(tail[1]!.role).toBe('tool');
    expect(tail[1]!.tool_call_id).toBe('c1');
    // 原始历史没被污染
    expect(second.messages[0]).toEqual(baseMessages()[0]);
    expect(second.messages[1]).toEqual(baseMessages()[1]);
  });

  it('观察步骤带 URL 与状态，source=web', async () => {
    const gw = gatewayWith([
      {
        text: '', truncated: false,
        toolCalls: [{ id: 'c1', name: WEB_FETCH_TOOL_NAME, arguments: '{"url":"https://example.com/"}' }],
      },
      { text: 'done', truncated: false },
    ]);
    const steps: WebTraceStep[] = [];
    await runWebToolLoop(
      { gateway: gw, toolDeps: toolDeps() },
      { messages: baseMessages(), onTrace: (s) => steps.push(s) },
    );
    const observe = steps.find((s) => s.phase === 'observe');
    expect(observe?.source).toBe('web');
    expect(observe?.detail).toContain('https://example.com/');
    expect(observe?.detail).toContain('HTTP 200');
  });

  it('未知工具名 → 观察告知可用工具，不静默卡死', async () => {
    const gw = gatewayWith([
      { text: '', truncated: false, toolCalls: [{ id: 'c1', name: 'nope', arguments: '{}' }] },
      { text: '改用正确工具', truncated: false },
    ]);
    const r = await runWebToolLoop({ gateway: gw, toolDeps: toolDeps() }, { messages: baseMessages() });
    const second = gw.calls[1] as { messages: Array<{ role: string; content: string }> };
    expect(second.messages.at(-1)!.content).toContain('未知工具');
    expect(r.reply).toBe('改用正确工具');
  });

  it('模型调用失败 → 明确回复，不把错误写死进 loop', async () => {
    const gw = {
      isReady: () => true,
      execute: vi.fn(async () => { throw new Error('超时'); }),
    } as unknown as IModelGateway;
    const r = await runWebToolLoop({ gateway: gw, toolDeps: toolDeps() }, { messages: baseMessages() });
    expect(r.reply).toContain('模型调用失败：超时');
    expect(r.trace.at(-1)!.ok).toBe(false);
  });

  it('轮数上限沿用 DEFAULT_PLUGIN_MAX_ATTEMPTS+1，用尽时标记 exhausted', async () => {
    const alwaysCall: ModelResult = {
      text: '', truncated: false,
      toolCalls: [{ id: 'c', name: WEB_FETCH_TOOL_NAME, arguments: '{"url":"https://example.com/"}' }],
    };
    const gw = gatewayWith([alwaysCall]);
    const r = await runWebToolLoop({ gateway: gw, toolDeps: toolDeps() }, { messages: baseMessages() });
    expect(r.turns).toBe(DEFAULT_PLUGIN_MAX_ATTEMPTS + 1);
    expect(r.exhausted).toBe(true);
    expect(r.reply).toContain('最大决策次数');
  });

  it('每轮请求都带 tools 声明（能力由宿主提供，决策由模型做）', async () => {
    const gw = gatewayWith([{ text: 'ok', truncated: false }]);
    await runWebToolLoop({ gateway: gw, toolDeps: toolDeps() }, { messages: baseMessages() });
    const req = gw.calls[0] as { tools: Array<{ name: string }> };
    // 工具表是唯一扩展点：web_fetch 保持原样，PDF / 图片作为独立能力登记
    expect(req.tools.map((t) => t.name)).toEqual([
      WEB_FETCH_TOOL_NAME, WEB_READ_PDF_TOOL_NAME, WEB_READ_IMAGE_TOOL_NAME,
    ]);
  });
});
