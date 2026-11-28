/**
 * web_fetch 按 Content-Type charset 解码（GBK 根治回归锁）
 *
 * 2026-11-28 实测：qt.gtimg.cn 返回 text/html; charset=GBK，
 * 而 Response.text() 恒按 UTF-8 解 → 中文名称乱码。本文件锁住：
 *   非 UTF-8 声明走 TextDecoder 正确解码；UTF-8 / 无声明 / 未知标签
 *   全部保持或回退到原 text() 行为，不让原本能成的抓取失败。
 *
 * GBK 字节来源：本次诊断 curl 实得响应体（贵州茅台 = b9 f3 d6 dd c3 a9 cc a8），
 * 不是手工编造的编码表。
 */
import { describe, it, expect, vi } from 'vitest';
import { executeWebFetch } from '../WebFetchTool';
import { createMemoryWebFetchCache } from '../WebFetchCache';

const URL_ = 'https://qt.gtimg.cn/q=s_sh600519';
// 「贵州茅台」GBK + 前后 ASCII，模拟真实响应行
const GBK_LINE = Uint8Array.from([
  0x76, 0x5f, 0x73, 0x5f, 0x73, 0x68, 0x36, 0x30, 0x30, 0x35, 0x31, 0x39, 0x3d, 0x22,
  0x31, 0x7e,
  0xb9, 0xf3, 0xd6, 0xdd, 0xc3, 0xa9, 0xcc, 0xa8, // 贵州茅台
  0x7e, 0x36, 0x30, 0x30, 0x35, 0x31, 0x39, 0x7e, 0x31, 0x34, 0x37, 0x32, 0x2e, 0x33, 0x36,
  0x22, 0x3b,
]);

function byteDeps(body: Uint8Array, contentType: string) {
  const text = vi.fn(async () => new TextDecoder('utf-8').decode(body)); // 模拟 text() 的 UTF-8 误解码
  const arrayBuffer = vi.fn(async () =>
    body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer);
  return {
    proxyUrl: 'https://api.weiqi.lol',
    timeoutMs: 60_000,
    cache: createMemoryWebFetchCache(),
    fetchImpl: vi.fn(async () => ({
      ok: true, status: 200, statusText: 'OK',
      headers: new Headers({ 'content-type': contentType }),
      text, arrayBuffer,
    })) as unknown as typeof fetch,
    _text: text, _arrayBuffer: arrayBuffer,
  };
}

describe('executeWebFetch charset 解码', () => {
  it('GBK 声明：中文正确解码进正文与缓存，无替换字符，且走 arrayBuffer 而非 text()', async () => {
    const d = byteDeps(GBK_LINE, 'text/html; charset=GBK');
    const r = await executeWebFetch({ url: URL_ }, d);
    expect(r.ok).toBe(true);
    expect(r.observation).toContain('贵州茅台');
    expect(r.observation).not.toContain('\ufffd');
    expect(d.cache.get(URL_)!.text).toContain('贵州茅台');
    expect(d._arrayBuffer).toHaveBeenCalledTimes(1);
    expect(d._text).not.toHaveBeenCalled();
  });

  it('charset="gbk" 带引号 / GB18030 大小写同样生效', async () => {
    for (const ct of ['text/html; charset="gbk"', 'text/html; CHARSET=GB18030']) {
      const d = byteDeps(GBK_LINE, ct);
      const r = await executeWebFetch({ url: URL_ }, d);
      expect(r.observation, ct).toContain('贵州茅台');
    }
  });

  it('UTF-8 声明：逐字走原 text()，arrayBuffer 不被调用', async () => {
    const utf8 = new TextEncoder().encode('v="1~贵州茅台~600519"');
    const d = byteDeps(utf8, 'text/html; charset=utf-8');
    const r = await executeWebFetch({ url: URL_ }, d);
    expect(r.ok).toBe(true);
    expect(r.observation).toContain('贵州茅台');
    expect(d._text).toHaveBeenCalledTimes(1);
    expect(d._arrayBuffer).not.toHaveBeenCalled();
  });

  it('无 charset 声明：沿用原 text() 路径', async () => {
    const utf8 = new TextEncoder().encode('<html>plain</html>');
    const d = byteDeps(utf8, 'text/html');
    const r = await executeWebFetch({ url: URL_ }, d);
    expect(r.observation).toContain('plain');
    expect(d._text).toHaveBeenCalledTimes(1);
    expect(d._arrayBuffer).not.toHaveBeenCalled();
  });

  it('运行时不支持的编码标签：安全回退 text()，抓取不失败', async () => {
    const utf8 = new TextEncoder().encode('fallback-ok');
    const d = byteDeps(utf8, 'text/html; charset=x-does-not-exist');
    const r = await executeWebFetch({ url: URL_ }, d);
    expect(r.ok).toBe(true);
    expect(r.observation).toContain('fallback-ok');
    expect(d._text).toHaveBeenCalledTimes(1);
    expect(d._arrayBuffer).not.toHaveBeenCalled();
  });

  it('二进制（application/pdf 无 charset）：不受解码改造影响', async () => {
    const d = byteDeps(Uint8Array.from([0x25, 0x50, 0x44, 0x46]), 'application/pdf');
    const r = await executeWebFetch({ url: URL_ }, d);
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('二进制');
  });
});
