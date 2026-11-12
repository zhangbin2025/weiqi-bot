/**
 * 宿主级 web_fetch 工具契约测试
 * 锁住：URL 防护、参数失败变观察、二进制不进上下文、超时沿用注入值。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  WEB_FETCH_TOOL, WEB_FETCH_TOOL_NAME,
  validateWebFetchUrl, executeWebFetch,
} from '../WebFetchTool';

const deps = () => ({
  proxyUrl: 'https://api.weiqi.lol',
  timeoutMs: 60_000,
  fetchImpl: vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    text: async () => '<html>柯洁</html>',
  })) as unknown as typeof fetch,
});

describe('WEB_FETCH_TOOL 声明', () => {
  it('名字与参数 schema 对齐标准 function calling', () => {
    expect(WEB_FETCH_TOOL.name).toBe(WEB_FETCH_TOOL_NAME);
    expect(WEB_FETCH_TOOL.parameters.required).toEqual(['url']);
    expect(WEB_FETCH_TOOL.parameters.type).toBe('object');
  });
});

describe('validateWebFetchUrl', () => {
  it('放行 https / http 公开地址', () => {
    expect(validateWebFetchUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(validateWebFetchUrl('http://example.com/')).toBe('http://example.com/');
  });
  it('拒绝非 http/https 协议', () => {
    expect(() => validateWebFetchUrl('file:///etc/passwd')).toThrow('只允许 http/https');
    expect(() => validateWebFetchUrl('ftp://example.com/x')).toThrow('只允许 http/https');
    expect(() => validateWebFetchUrl('javascript:alert(1)')).toThrow('只允许 http/https');
  });
  it('拒绝环回 / 私网字面地址（RFC 1918 / 3927 / 5735）', () => {
    for (const u of [
      'http://127.0.0.1/', 'http://localhost/', 'http://LOCALHOST/', 'http://foo.local/',
      'http://10.0.0.1/', 'http://172.16.0.1/', 'http://192.168.1.1/',
      'http://169.254.169.254/latest/', 'http://0.0.0.0/', 'http://224.0.0.1/',
      'http://[::1]/', 'http://[fd00::1]/',
    ]) {
      expect(() => validateWebFetchUrl(u), u).toThrow('环回或私网');
    }
  });
  it('非法 URL 文本给出可读错误', () => {
    expect(() => validateWebFetchUrl('not-a-url')).toThrow('不是合法的绝对 URL');
  });
});

describe('executeWebFetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('正常文本：观察含状态 / Content-Type / 正文，且打到代理 URL', async () => {
    const d = deps();
    const r = await executeWebFetch(JSON.stringify({ url: 'https://example.com/' }), d);
    expect(r.ok).toBe(true);
    expect(r.observation).toContain('HTTP 200');
    expect(r.observation).toContain('<html>柯洁</html>');
    expect((d.fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0])
      .toBe('https://api.weiqi.lol/?url=https%3A%2F%2Fexample.com%2F');
  });

  it('参数无效 / 防护拒绝都变成观察，不抛给 loop', async () => {
    const d = deps();
    const bad = await executeWebFetch('{}', d);
    expect(bad.ok).toBe(false);
    expect(bad.observation).toContain('参数无效');
    const ssrf = await executeWebFetch(JSON.stringify({ url: 'http://127.0.0.1/' }), d);
    expect(ssrf.ok).toBe(false);
    expect(ssrf.observation).toContain('环回或私网地址');
    expect(d.fetchImpl).not.toHaveBeenCalled();
  });

  it('二进制资源不往上下文塞，明确告知模型', async () => {
    const d = deps();
    d.fetchImpl = vi.fn(async () => ({
      ok: true, status: 200, statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/pdf' }),
      text: async () => '%PDF-1.4',
    })) as unknown as typeof fetch;
    const r = await executeWebFetch(JSON.stringify({ url: 'https://example.com/a.pdf' }), d);
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('二进制内容');
    expect(r.observation).not.toContain('%PDF-1.4');
  });

  it('上游非 2xx 也算观察（模型自己决定重试或说明）', async () => {
    const d = deps();
    d.fetchImpl = vi.fn(async () => ({
      ok: false, status: 404, statusText: 'Not Found',
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => 'not found',
    })) as unknown as typeof fetch;
    const r = await executeWebFetch(JSON.stringify({ url: 'https://example.com/x' }), d);
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('HTTP 404');
  });

  it('fetch 抛错 / 超时都变成观察，不中断 loop', async () => {
    const d = deps();
    d.fetchImpl = vi.fn(async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    const r = await executeWebFetch(JSON.stringify({ url: 'https://example.com/' }), d);
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('network down');
  });
});
