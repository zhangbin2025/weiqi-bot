/**
 * 资源输入层契约：URL/本地汇合、魔数判定、base64、SSRF 防护、失败变观察。
 * 数值口径不在这里断言任何新阈值（决策 5A：不新设字节上限）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  sniffResourceKind, resolveMimeType, bytesToBase64, toDataUri,
  fetchResourceFromUrl, resourceFromFile,
} from '../ResourceInput';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];
const GIF_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // GIF89a

describe('sniffResourceKind', () => {
  it('PDF 魔数优先，content-type 可为空', () => {
    expect(sniffResourceKind(new Uint8Array(PDF_MAGIC), '')).toBe('pdf');
    expect(sniffResourceKind(new Uint8Array(PDF_MAGIC), 'application/octet-stream')).toBe('pdf');
  });
  it('PDF content-type 兜底（无魔数的截断响应也能识别）', () => {
    expect(sniffResourceKind(new Uint8Array([1, 2, 3]), 'application/pdf; charset=binary')).toBe('pdf');
  });
  it('raster 图片按魔数识别', () => {
    expect(sniffResourceKind(new Uint8Array(PNG_MAGIC), '')).toBe('image');
    expect(sniffResourceKind(new Uint8Array(JPEG_MAGIC), '')).toBe('image');
    expect(sniffResourceKind(new Uint8Array(GIF_MAGIC), '')).toBe('image');
  });
  it('SVG / AVIF 等白名单外类型明确 unsupported，不塞进上下文假装读过', () => {
    expect(sniffResourceKind(new Uint8Array([0x3c, 0x73, 0x76, 0x67]), 'image/svg+xml')).toBe('unsupported');
    expect(sniffResourceKind(new Uint8Array([1, 2, 3]), 'application/octet-stream')).toBe('unsupported');
  });
});

describe('MIME / base64', () => {
  it('data URI 用精确 MIME，不一律 octet-stream', () => {
    expect(resolveMimeType(new Uint8Array(PNG_MAGIC), '', 'image')).toBe('image/png');
    expect(resolveMimeType(new Uint8Array(JPEG_MAGIC), '', 'image')).toBe('image/jpeg');
    expect(resolveMimeType(new Uint8Array(PDF_MAGIC), '', 'pdf')).toBe('application/pdf');
  });
  it('base64 逐字节编码正确，data URI 形状符合决策 3a', () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    expect(toDataUri(bytes, 'image/png')).toBe(`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`);
  });
});

describe('fetchResourceFromUrl', () => {
  afterEach(() => vi.unstubAllGlobals());

  const deps = (body: Uint8Array, contentType: string, ok = true, status = 200) => ({
    proxyUrl: 'https://api.weiqi.lol',
    timeoutMs: 60_000,
    fetchImpl: vi.fn(async () => ({
      ok, status, statusText: ok ? 'OK' : 'Forbidden',
      headers: new Headers({ 'content-type': contentType }),
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    })) as unknown as typeof fetch,
  });

  it('PDF 字节完整回来，来源 URL 与展示名保留（来源标注用）', async () => {
    const d = deps(new Uint8Array(PDF_MAGIC), 'application/pdf');
    const r = await fetchResourceFromUrl('https://example.com/a/doc.pdf', d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.resource.mimeType).toBe('application/pdf');
    expect(r.resource.sourceUrl).toBe('https://example.com/a/doc.pdf');
    expect(r.resource.label).toBe('doc.pdf');
    expect(Array.from(r.resource.bytes)).toEqual(PDF_MAGIC);
    // 代理 URL 拼接与显式 UA（图片站点常因缺 UA 返 403）
    const call = (d.fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(call[0])).toContain('url=https%3A%2F%2Fexample.com%2Fa%2Fdoc.pdf');
  });

  it('私有地址沿用 validateWebFetchUrl，SSRF 防护不因新工具失效', async () => {
    const d = deps(new Uint8Array(PDF_MAGIC), 'application/pdf');
    const r = await fetchResourceFromUrl('http://127.0.0.1/secret.pdf', d);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('环回或私网');
    expect(d.fetchImpl).not.toHaveBeenCalled();
  });

  it('HTTP 403 / 不支持类型都变成可读观察，不抛给 loop', async () => {
    const forbidden = deps(new Uint8Array([1]), 'text/html', false, 403);
    const r1 = await fetchResourceFromUrl('https://example.com/x.png', forbidden);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toContain('HTTP 403');

    const svg = deps(new Uint8Array([0x3c]), 'image/svg+xml');
    const r2 = await fetchResourceFromUrl('https://example.com/x.svg', svg);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toContain('不受支持');
  });
});

describe('resourceFromFile', () => {
  it('本地文件与 URL 走同一形状（两条来源汇合）', async () => {
    const file = {
      name: '棋谱.pdf',
      type: 'application/pdf',
      arrayBuffer: async () => new Uint8Array(PDF_MAGIC).buffer,
    };
    const r = await resourceFromFile(file);
    expect(r.label).toBe('棋谱.pdf');
    expect(r.mimeType).toBe('application/pdf');
    expect(r.sourceUrl).toBeUndefined();
  });
});
