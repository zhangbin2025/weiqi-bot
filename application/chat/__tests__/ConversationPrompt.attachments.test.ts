/**
 * 历史重放契约（决策 5A / 第 6 点）：
 * - 附件不计入文本字符预算（否则 base64 图片必被裁成半张）
 * - 附件随所在消息受 maxMessages 窗口约束
 * - PDF 文字附件原样给模型，不被 maxCharsPerMessage 截断
 * - 摘要/标题不碰附件（不会截到一串 base64）
 */
import { describe, it, expect } from 'vitest';
import {
  buildConversationMessages, summarizeSession, CONTEXT_LIMITS,
  CONVERSATION_SYSTEM_PROMPT,
} from '../ConversationPrompt';
import type { ChatAttachment } from '../ChatAttachment';
import type { ModelPart } from '../../model/IModelGateway';

const imageAttachment = (name: string): ChatAttachment => ({
  kind: 'image',
  mimeType: 'image/png',
  dataUri: `data:image/png;base64,${'A'.repeat(40_000)}`,
  label: name,
});

const pdfTextAttachment = (text: string): ChatAttachment => ({
  kind: 'pdf-text',
  text,
  label: 'doc.pdf',
  sourceUrl: 'https://example.com/doc.pdf',
});

describe('buildConversationMessages 附件重放', () => {
  it('system prompt 声明 PDF/图片能力，不再「刻意不提」', () => {
    const msgs = buildConversationMessages([{ role: 'user', content: '你好' }]);
    expect(msgs[0]!.content).toBe(CONVERSATION_SYSTEM_PROMPT);
    expect(String(msgs[0]!.content)).toContain('web_read_pdf');
    expect(String(msgs[0]!.content)).toContain('web_read_image');
  });

  it('图片附件的 base64 不计入字符预算、不被裁成 2000 字符', () => {
    const a = imageAttachment('board.png');
    const msgs = buildConversationMessages([
      { role: 'user', content: '这是什么开局？', attachments: [a] },
    ]);
    const parts = msgs[1]!.content as ModelPart[];
    expect(Array.isArray(parts)).toBe(true);
    const image = parts.find((p) => p.type === 'image');
    expect(image?.type).toBe('image');
    if (image?.type === 'image') {
      expect(image.uri).toBe(a.dataUri); // 完整保留
      expect(image.uri.length).toBeGreaterThan(CONTEXT_LIMITS.maxCharsPerMessage);
    }
  });

  it('PDF 文字附件原样重放（不按单条 2000 字截断），带来源 URL', () => {
    const long = '棋谱内容 '.repeat(1000); // >2000
    const msgs = buildConversationMessages([
      { role: 'user', content: '总结一下', attachments: [pdfTextAttachment(long)] },
    ]);
    const parts = msgs[1]!.content as ModelPart[];
    const textPart = parts.find((p) => p.type === 'text' && p.text.includes('此前读取的 PDF'));
    expect(textPart?.type).toBe('text');
    if (textPart?.type === 'text') {
      expect(textPart.text).toContain(long);
      expect(textPart.text).toContain('https://example.com/doc.pdf');
    }
  });

  it('附件随所在消息受 maxMessages 窗口约束（滚出窗口即不再重放）', () => {
    const history = Array.from({ length: CONTEXT_LIMITS.maxMessages + 1 }, (_, i) => ({
      role: 'user' as const,
      content: `msg-${i}`,
      ...(i === 0 ? { attachments: [imageAttachment('old.png')] as ChatAttachment[] } : {}),
    }));
    const msgs = buildConversationMessages(history);
    expect(msgs).toHaveLength(CONTEXT_LIMITS.maxMessages + 1); // + system
    expect(msgs.slice(1).every((m) => typeof m.content === 'string')).toBe(true);
    expect(msgs.slice(1)[0]!.content).toBe('msg-1');
  });
});

describe('summarizeSession', () => {
  it('附件不进标题，纯附件消息回退「新对话」而不是截 base64', () => {
    expect(summarizeSession([
      { role: 'user', content: '', attachments: [imageAttachment('board.png')] },
    ])).toBe('新对话');
    expect(summarizeSession([
      { role: 'user', content: '帮我看这张棋谱', attachments: [imageAttachment('board.png')] },
    ])).toBe('帮我看这张棋谱');
  });
});
