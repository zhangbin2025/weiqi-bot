/**
 * 新工具层契约：URL → 资源 → 正确处理；种类不符提示换工具；工具表登记。
 * 不测真实网络（代理已单独实测过字节透传），用注入 fetch。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  WEB_READ_PDF_TOOL, WEB_READ_IMAGE_TOOL, WEB_READ_PDF_TOOL_NAME, WEB_READ_IMAGE_TOOL_NAME,
  executeWebReadPdf, executeWebReadImage,
} from '../WebResourceTools';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function deps(body: number[], contentType: string) {
  return {
    proxyUrl: 'https://api.weiqi.lol',
    timeoutMs: 60_000,
    fetchImpl: vi.fn(async () => ({
      ok: true, status: 200, statusText: 'OK',
      headers: new Headers({ 'content-type': contentType }),
      arrayBuffer: async () => new Uint8Array(body).buffer,
    })) as unknown as typeof fetch,
  };
}

/** 注入全局 pdfjsLib（text 模式需要） */
function stubPdfJs(): void {
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
}

describe('工具声明', () => {
  it('两个新工具各自独立，参数 schema 对齐 function calling', () => {
    expect(WEB_READ_PDF_TOOL.name).toBe(WEB_READ_PDF_TOOL_NAME);
    expect(WEB_READ_PDF_TOOL.parameters.required).toEqual(['url']);
    expect(WEB_READ_IMAGE_TOOL.name).toBe(WEB_READ_IMAGE_TOOL_NAME);
    expect(WEB_READ_IMAGE_TOOL.parameters.required).toEqual(['url']);
  });
});

describe('executeWebReadPdf', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('默认 text 模式抽文字，观察带来源 URL', async () => {
    stubPdfJs();
    const r = await executeWebReadPdf(
      JSON.stringify({ url: 'https://example.com/a.pdf' }), deps(PDF_MAGIC, 'application/pdf'),
    );
    expect(r.ok).toBe(true);
    expect(r.observation).toContain('https://example.com/a.pdf');
    expect(r.observation).toContain('黑1 星位');
    expect(r.attachment?.kind).toBe('pdf-text');
  });

  it('mode=native 送模型原文，产出 file part', async () => {
    const r = await executeWebReadPdf(
      JSON.stringify({ url: 'https://example.com/a.pdf', mode: 'native' }),
      deps(PDF_MAGIC, 'application/pdf'),
    );
    expect(r.parts?.[0]?.type).toBe('file');
    expect(r.attachment?.kind).toBe('pdf-native');
  });

  it('目标其实是图片 → 明确告知改用 web_read_image，不静默按错种类处理', async () => {
    const r = await executeWebReadPdf(
      JSON.stringify({ url: 'https://example.com/x.png' }), deps(PNG_MAGIC, 'image/png'),
    );
    expect(r.ok).toBe(false);
    expect(r.observation).toContain(WEB_READ_IMAGE_TOOL_NAME);
  });

  it('参数坏 / URL 私网都变可读观察，不抛', async () => {
    const d = deps(PDF_MAGIC, 'application/pdf');
    const bad = await executeWebReadPdf('not-json', d);
    expect(bad.ok).toBe(false);
    expect(bad.observation).toContain('参数');
    const ssrf = await executeWebReadPdf(JSON.stringify({ url: 'http://192.168.1.1/a.pdf' }), d);
    expect(ssrf.ok).toBe(false);
    expect(ssrf.observation).toContain('环回或私网');
  });
});

describe('executeWebReadImage', () => {
  it('图片 → image part + image 附件，data URI 不传远程 URL', async () => {
    const r = await executeWebReadImage(
      JSON.stringify({ url: 'https://example.com/board.png' }), deps(PNG_MAGIC, 'image/png'),
    );
    expect(r.ok).toBe(true);
    if (r.parts?.[0]?.type === 'image') {
      expect(r.parts[0].uri.startsWith('data:image/png;base64,')).toBe(true);
    }
    expect(r.attachment?.kind).toBe('image');
  });

  it('目标其实是 PDF → 明确告知改用 web_read_pdf', async () => {
    const r = await executeWebReadImage(
      JSON.stringify({ url: 'https://example.com/a.pdf' }), deps(PDF_MAGIC, 'application/pdf'),
    );
    expect(r.ok).toBe(false);
    expect(r.observation).toContain(WEB_READ_PDF_TOOL_NAME);
  });
});
