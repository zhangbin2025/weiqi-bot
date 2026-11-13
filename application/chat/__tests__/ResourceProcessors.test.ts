/**
 * 资源处理器：PDF 端侧抽文字 / native 原生 / 图片 base64，以及失败不编造内容。
 * pdf.js 用全局 mock 注入（与 event 页相同的加载方式，不引入 npm 依赖）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { processPdf, processImage, parsePdfMode } from '../ResourceProcessors';
import type { ResourceInput } from '../ResourceInput';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];
const pdfResource = (): ResourceInput => ({
  bytes: new Uint8Array(PDF_MAGIC),
  mimeType: 'application/pdf',
  kind: 'pdf',
  label: 'doc.pdf',
  sourceUrl: 'https://example.com/doc.pdf',
});
const imageResource = (): ResourceInput => ({
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  mimeType: 'image/png',
  kind: 'image',
  label: 'board.png',
  sourceUrl: 'https://example.com/board.png',
});

/** 注入全局 pdfjsLib（PdfTextExtractor 只依赖这三个成员） */
function stubPdfJs(itemsPerPage: string[][]): void {
  const global = globalThis as unknown as { pdfjsLib?: unknown };
  global.pdfjsLib = {
    // 模拟 defer 加载完成但还没设 workerSrc 的状态
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: itemsPerPage.length,
        getPage: async (n: number) => ({
          getTextContent: async () => ({
            items: itemsPerPage[n - 1]!.map((str) => ({ str })),
          }),
        }),
        destroy: async () => undefined,
      }),
    }),
  };
}

describe('parsePdfMode', () => {
  it('默认 text，非法值不抛错', () => {
    expect(parsePdfMode(undefined)).toBe('text');
    expect(parsePdfMode('native')).toBe('native');
    expect(parsePdfMode('wat')).toBe('text');
  });
});

describe('processPdf', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('text 模式逐页抽文字，观察带来源 URL，附件是 pdf-text；defer 后懒设 workerSrc', async () => {
    stubPdfJs([['黑1', '星位'], ['白2', '小目']]);
    const r = await processPdf(pdfResource(), 'text');
    expect(r.ok).toBe(true);
    const lib = (globalThis as unknown as { pdfjsLib: { GlobalWorkerOptions: { workerSrc: string } } }).pdfjsLib;
    expect(lib.GlobalWorkerOptions.workerSrc).toContain('pdf.worker.min.js');
    expect(r.observation).toContain('https://example.com/doc.pdf');
    expect(r.observation).toContain('[第 1 页]');
    expect(r.observation).toContain('黑1 星位');
    expect(r.observation).toContain('[第 2 页]');
    expect(r.parts).toBeUndefined(); // 文本观察不追加多模态 user 消息
    expect(r.attachment?.kind).toBe('pdf-text');
    if (r.attachment?.kind === 'pdf-text') {
      expect(r.attachment.text).toContain('白2 小目');
      expect(r.attachment.sourceUrl).toBe('https://example.com/doc.pdf');
    }
  });

  it('扫描件（无文字层）明确回「无法提取」，不编造内容，提示可改 native', async () => {
    stubPdfJs([[], []]);
    const r = await processPdf(pdfResource(), 'text');
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('没有可提取的文字层');
    expect(r.observation).toContain('native');
    expect(r.attachment).toBeUndefined(); // 没读到就不落历史
  });

  it('native 模式整份送模型：file part + pdf-native 附件，data URI 是 PDF', async () => {
    // native 不应该碰 pdf.js（没加载也不该报错）
    const global = globalThis as unknown as { pdfjsLib?: unknown };
    delete global.pdfjsLib;
    const r = await processPdf(pdfResource(), 'native');
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('原生 PDF');
    expect(r.parts?.[0]?.type).toBe('file');
    if (r.parts?.[0]?.type === 'file') {
      expect(r.parts[0].uri.startsWith('data:application/pdf;base64,')).toBe(true);
      expect(r.parts[0].mimeType).toBe('application/pdf');
    }
    expect(r.attachment?.kind).toBe('pdf-native');
  });

  it('pdf.js 不可用（CDN 挂了）→ 明确失败观察，不假装读过', async () => {
    const global = globalThis as unknown as { pdfjsLib?: unknown };
    delete global.pdfjsLib;
    const r = await processPdf(pdfResource(), 'text');
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('pdf.js 未加载');
    expect(r.observation).toContain('native');
  });
});

describe('processImage', () => {
  it('base64 内嵌为 data URI，image part + image 附件（决策 3a）', () => {
    const r = processImage(imageResource());
    expect(r.ok).toBe(true);
    expect(r.parts?.[0]?.type).toBe('image');
    if (r.parts?.[0]?.type === 'image') {
      expect(r.parts[0].uri.startsWith('data:image/png;base64,')).toBe(true);
    }
    expect(r.attachment?.kind).toBe('image');
    expect(r.observation).toContain('https://example.com/board.png');
  });
});
