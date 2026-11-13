/**
 * loop 的多模态契约：图片/原生 PDF 观察后追加多模态 user 消息、附件收集、
 * 观察裁剪沿用 CONTEXT_LIMITS、失败不编造内容。
 */
import { describe, it, expect, vi } from 'vitest';
import { runWebToolLoop } from '../WebToolLoop';
import { CONTEXT_LIMITS } from '../ConversationPrompt';
import { WEB_READ_IMAGE_TOOL_NAME, WEB_READ_PDF_TOOL_NAME } from '../WebResourceTools';
import type { IModelGateway, ModelResult } from '../../model/IModelGateway';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

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

const binaryDeps = (body: number[], contentType: string) => ({
  proxyUrl: 'https://api.weiqi.lol',
  timeoutMs: 60_000,
  fetchImpl: vi.fn(async () => ({
    ok: true, status: 200, statusText: 'OK',
    headers: new Headers({ 'content-type': contentType }),
    arrayBuffer: async () => new Uint8Array(body).buffer,
  })) as unknown as typeof fetch,
});

const base = () => [
  { role: 'system' as const, content: '你是助手' },
  { role: 'user' as const, content: '看看这个资源' },
];

/** 取第二轮请求的消息尾部（assistant tool_calls / tool 观察 / 追加的 user） */
function tail(calls: unknown[]): Array<{ role: string; content: unknown; tool_call_id?: string }> {
  const second = calls[1] as { messages: Array<{ role: string; content: unknown; tool_call_id?: string }> };
  return second.messages.slice(-3) as Array<{ role: string; content: unknown; tool_call_id?: string }>;
}

describe('WebToolLoop 多模态观察', () => {
  it('图片工具后追加一条带 image_url part 的 user 消息，附件回收给上层', async () => {
    const gw = gatewayWith([
      {
        text: '', truncated: false,
        toolCalls: [{
          id: 'c1', name: WEB_READ_IMAGE_TOOL_NAME,
          arguments: '{"url":"https://example.com/board.png"}',
        }],
      },
      { text: '图上是星位开局', truncated: false },
    ]);
    const r = await runWebToolLoop(
      { gateway: gw, toolDeps: binaryDeps(PNG_MAGIC, 'image/png') },
      { messages: base() },
    );
    expect(r.reply).toBe('图上是星位开局');
    const t = tail(gw.calls);
    expect(t[0]!.role).toBe('assistant');
    expect(t[1]!.role).toBe('tool');
    expect(typeof t[1]!.content).toBe('string'); // tool 观察永远纯文本
    expect(t[1]!.tool_call_id).toBe('c1');
    expect(t[2]!.role).toBe('user'); // 多模态 part 放独立 user 消息
    const parts = t[2]!.content as Array<{ type: string; uri?: string; text?: string }>;
    expect(parts[0]!.type).toBe('text');
    expect(parts[1]!.type).toBe('image');
    expect(parts[1]!.uri?.startsWith('data:image/png;base64,')).toBe(true);
    expect(r.attachments).toHaveLength(1);
    expect(r.attachments[0]!.kind).toBe('image');
  });

  it('原生 PDF 工具后追加 file part 的 user 消息，附件是 pdf-native', async () => {
    const gw = gatewayWith([
      {
        text: '', truncated: false,
        toolCalls: [{
          id: 'c2', name: WEB_READ_PDF_TOOL_NAME,
          arguments: '{"url":"https://example.com/doc.pdf","mode":"native"}',
        }],
      },
      { text: 'PDF 已读', truncated: false },
    ]);
    const r = await runWebToolLoop(
      { gateway: gw, toolDeps: binaryDeps(PDF_MAGIC, 'application/pdf') },
      { messages: base() },
    );
    const parts = tail(gw.calls)[2]!.content as Array<{ type: string; uri?: string }>;
    expect(parts.some((p) => p.type === 'file' && p.uri?.startsWith('data:application/pdf;base64,'))).toBe(true);
    expect(r.attachments[0]!.kind).toBe('pdf-native');
  });

  it('PDF 端侧抽文字只走文本观察，不追加多模态消息（复用文本链路）', async () => {
    (globalThis as unknown as { pdfjsLib?: unknown }).pdfjsLib = {
      GlobalWorkerOptions: { workerSrc: '' },
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({ getTextContent: async () => ({ items: [{ str: '黑1 星位' }] }) }),
          destroy: async () => undefined,
        }),
      }),
    };
    const gw = gatewayWith([
      {
        text: '', truncated: false,
        toolCalls: [{
          id: 'c3', name: WEB_READ_PDF_TOOL_NAME,
          arguments: '{"url":"https://example.com/doc.pdf"}',
        }],
      },
      { text: '文字已读', truncated: false },
    ]);
    const r = await runWebToolLoop(
      { gateway: gw, toolDeps: binaryDeps(PDF_MAGIC, 'application/pdf') },
      { messages: base() },
    );
    const second = gw.calls[1] as { messages: Array<{ role: string; content: unknown }> };
    // 只有 assistant + tool 两条，没有额外 user 消息
    expect(second.messages.slice(-2).map((m) => m.role)).toEqual(['assistant', 'tool']);
    expect(String(second.messages.at(-1)!.content)).toContain('黑1 星位');
    expect(r.attachments[0]!.kind).toBe('pdf-text');
  });

  it('超长观察按 maxCharsPerMessage 裁剪，且给模型可见的截断提示', async () => {
    const big = 'x'.repeat(CONTEXT_LIMITS.maxCharsPerMessage + 5000);
    const deps = {
      proxyUrl: 'https://api.weiqi.lol',
      timeoutMs: 60_000,
      fetchImpl: vi.fn(async () => ({
        ok: true, status: 200, statusText: 'OK',
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: async () => big,
      })) as unknown as typeof fetch,
    };
    const gw = gatewayWith([
      {
        text: '', truncated: false,
        toolCalls: [{ id: 'c4', name: 'web_fetch', arguments: '{"url":"https://example.com/long.txt"}' }],
      },
      { text: 'done', truncated: false },
    ]);
    await runWebToolLoop({ gateway: gw, toolDeps: deps }, { messages: base() });
    const second = gw.calls[1] as { messages: Array<{ role: string; content: string }> };
    const observation = second.messages.at(-1)!.content;
    expect(observation.length).toBeLessThanOrEqual(CONTEXT_LIMITS.maxCharsPerMessage);
    expect(observation).toContain('已截断');
  });
});
