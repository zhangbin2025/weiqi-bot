/**
 * ChatUseCase 附件链路：本地文件在发送瞬间注入当前轮、工具附件落历史、
 * 不支持类型不编造内容。
 */
import { describe, it, expect, vi } from 'vitest';
import { ChatUseCase } from '../ChatUseCase';
import { WEB_READ_IMAGE_TOOL_NAME } from '../WebResourceTools';
import type { IModelGateway, ModelMessage } from '../../model/IModelGateway';
import type { IMessageRenderer } from '../../assistant/IMessageRenderer';
import type { ChatHistoryManager } from '../../assistant/ChatHistoryManager';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function renderer() {
  return {
    renderMessage: vi.fn().mockResolvedValue(undefined),
    clearMessages: vi.fn(), showTyping: vi.fn(), hideTyping: vi.fn(),
    showCountdownJump: vi.fn(),
    renderPluginTrace: vi.fn().mockResolvedValue(undefined),
    beginPluginTrace: vi.fn().mockReturnValue(true),
    appendPluginTraceStep: vi.fn(),
    finishPluginTrace: vi.fn(),
  } as unknown as IMessageRenderer;
}

function history() {
  const store: Array<{ role: 'user' | 'assistant'; content: string; attachments?: unknown[] }> = [];
  const h = {
    store,
    getMessages: vi.fn(() => store),
    addMessage: vi.fn(async (m: typeof store[number]) => { store.push(m); }),
    setCurrentSessionTitle: vi.fn().mockResolvedValue(undefined),
    getCurrentSession: vi.fn(() => null),
    appendAttachmentsToLastUser: vi.fn(async (a: unknown[]) => {
      for (let i = store.length - 1; i >= 0; i--) {
        if (store[i]!.role === 'user') {
          store[i]!.attachments = [...(store[i]!.attachments ?? []), ...a];
          return;
        }
      }
    }),
  };
  return h as unknown as ChatHistoryManager & { store: typeof store; addMessage: ReturnType<typeof vi.fn> };
}

const webTools = {
  proxyUrl: 'https://api.weiqi.lol', timeoutMs: 60_000,
  fetchImpl: vi.fn(async () => ({
    ok: true, status: 200, statusText: 'OK',
    headers: new Headers({ 'content-type': 'image/png' }),
    arrayBuffer: async () => new Uint8Array(PNG_MAGIC).buffer,
  })) as unknown as typeof fetch,
};

/** 记录每轮 messages，最后一步给最终文本 */
function gateway(steps: Array<{ text: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }>) {
  const calls: ModelMessage[][] = [];
  let i = 0;
  return {
    calls,
    isReady: () => true,
    execute: vi.fn(async (req: { messages: ModelMessage[] }) => {
      calls.push(req.messages.map((m) => ({ ...m })));
      const s = steps[Math.min(i++, steps.length - 1)]!;
      return { text: s.text, truncated: false, ...(s.toolCalls ? { toolCalls: s.toolCalls } : {}) };
    }),
  } as unknown as IModelGateway & { calls: ModelMessage[][] };
}

function make(gw: IModelGateway, h: ChatHistoryManager, r: IMessageRenderer): ChatUseCase {
  return new ChatUseCase(gw, h, r, undefined, () => 'chat', webTools);
}

const localPng = (name = 'board.png') => ({
  name,
  type: 'image/png',
  arrayBuffer: async () => new Uint8Array(PNG_MAGIC).buffer,
});

describe('ChatUseCase 本地附件', () => {
  it('本地图片注入当前轮消息的多模态 part，且作为独立附件落历史（不进 content）', async () => {
    const h = history();
    const gw = gateway([{ text: '这是星位开局' }]);
    await make(gw, h, renderer()).send('这是什么？', { files: [localPng()] });
    const lastUser = gw.calls[0]!.at(-1)!;
    expect(lastUser.role).toBe('user');
    expect(Array.isArray(lastUser.content)).toBe(true);
    const parts = lastUser.content as Array<{ type: string; uri?: string }>;
    expect(parts.some((p) => p.type === 'image' && p.uri?.startsWith('data:image/png;base64,'))).toBe(true);
    // 历史里 content 是纯文本，附件独立字段
    expect(h.store[0]!.content).toBe('这是什么？');
    expect(h.store[0]!.attachments?.[0]).toMatchObject({ kind: 'image', label: 'board.png' });
    expect(JSON.stringify(h.store[0]!.content)).not.toContain('base64');
  });

  it('不支持的文件类型给可见提示，不编造内容、不阻断其它附件', async () => {
    const h = history();
    const gw = gateway([{ text: 'ok' }]);
    const r = renderer();
    const bad = { name: 'x.txt', type: 'text/plain', arrayBuffer: async () => new ArrayBuffer(3) };
    await make(gw, h, r).send('看看', { files: [bad, localPng()] });
    const bubble = (r.renderMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(bubble).toContain('不支持的文件类型');
    expect(h.store[0]!.attachments).toHaveLength(1); // 只有图片落历史
  });

  it('纯附件无文字时补明确问题，不对着图片猜意图', async () => {
    const h = history();
    const gw = gateway([{ text: 'ok' }]);
    await make(gw, h, renderer()).send('', { files: [localPng()] });
    expect(h.store[0]!.content).toContain('请阅读我附加的文件');
  });
});

describe('ChatUseCase 工具附件落历史（多轮追问）', () => {
  it('web_read_image 读到的图片补写进最后一条 user 消息', async () => {
    const h = history();
    const gw = gateway([
      {
        text: '',
        toolCalls: [{
          id: 'c1', name: WEB_READ_IMAGE_TOOL_NAME,
          arguments: '{"url":"https://example.com/board.png"}',
        }],
      },
      { text: '图上是小目' },
    ]);
    await make(gw, h, renderer()).send('看看 https://example.com/board.png');
    // addMessage 两次（user + assistant），补写发生在 user 上
    expect(h.store[0]!.attachments?.[0]).toMatchObject({ kind: 'image' });
    expect(h.store[0]!.content).toBe('看看 https://example.com/board.png');
    expect(h.store[1]!.attachments).toBeUndefined(); // 不落在 assistant 上
  });
});
