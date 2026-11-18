/**
 * web_fetch 缓存 + web_cache_read 契约测试
 *
 * 锁住用户实测暴露的根因：ToolLoop.clipObservation() 会把超长观察裁到
 * CONTEXT_LIMITS.maxCharsPerMessage，web_fetch 若把完整正文塞进观察，
 * 后半截根本没进模型上下文。因此完整正文留宿主缓存，观察只回元信息 +
 * 预览 + 句柄，其余部分由 web_cache_read 分页 / 正则读取。
 *
 * 数值口径：全文只引用 CONTEXT_LIMITS.maxCharsPerMessage 与
 * DEFAULT_PLUGIN_MAX_ATTEMPTS，不引入任何经验阈值。
 */
import { describe, it, expect, vi } from 'vitest';
import { CONTEXT_LIMITS } from '../ConversationPrompt';
import { executeWebFetch, WEB_FETCH_TOOL } from '../WebFetchTool';
import {
  WEB_CACHE_READ_TOOL, WEB_CACHE_READ_TOOL_NAME,
  executeWebCacheRead, createMemoryWebFetchCache, type WebFetchCache,
} from '../WebFetchCache';

const URL_ = 'https://example.com/big.json';
const BUDGET = CONTEXT_LIMITS.maxCharsPerMessage;

function deps(text: string, cache: WebFetchCache) {
  return {
    proxyUrl: 'https://api.weiqi.lol',
    timeoutMs: 60_000,
    cache,
    fetchImpl: vi.fn(async () => ({
      ok: true, status: 200, statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
      text: async () => text,
    })) as unknown as typeof fetch,
  };
}

async function fetchInto(text: string): Promise<WebFetchCache> {
  const cache = createMemoryWebFetchCache();
  await executeWebFetch(JSON.stringify({ url: URL_ }), deps(text, cache));
  return cache;
}

describe('工具声明', () => {
  it('web_fetch 描述里明确「预览只是一部分、其余用 web_cache_read 读」', () => {
    expect(WEB_FETCH_TOOL.description).toContain('web_cache_read');
    expect(WEB_FETCH_TOOL.description).toContain('预览只是一部分');
    expect(WEB_FETCH_TOOL.description).toContain('绝不能凭猜测补写');
  });
  it('web_cache_read 声明三种 mode 与 url 必填', () => {
    expect(WEB_CACHE_READ_TOOL.name).toBe(WEB_CACHE_READ_TOOL_NAME);
    expect(WEB_CACHE_READ_TOOL.parameters.required).toEqual(['url', 'mode']);
    expect(WEB_CACHE_READ_TOOL.description).toContain('slice');
    expect(WEB_CACHE_READ_TOOL.description).toContain('grep');
  });
});

describe('executeWebFetch 缓存行为', () => {
  it('完整正文进缓存，观察不含被裁掉的后半截、且不超过单条上限', async () => {
    const text = 'A'.repeat(BUDGET * 3);
    const cache = createMemoryWebFetchCache();
    const r = await executeWebFetch(JSON.stringify({ url: URL_ }), deps(text, cache));
    expect(r.ok).toBe(true);
    expect(cache.get(URL_)!.text).toBe(text);          // 全文完整留下
    expect(r.observation.length).toBeLessThanOrEqual(BUDGET);
    expect(r.observation).toContain('已存入宿主缓存');
    expect(r.observation).toContain('web_cache_read');
    expect(r.observation).toContain(`${text.length} 字符`);
    // 预览只是开头一段，不是全文
    expect(r.observation).not.toContain(text.slice(BUDGET));
  });

  it('同 URL 再次取回覆盖缓存，不重复增长', async () => {
    const cache = createMemoryWebFetchCache();
    await executeWebFetch(JSON.stringify({ url: URL_ }), deps('OLD', cache));
    await executeWebFetch(JSON.stringify({ url: URL_ }), deps('NEW', cache));
    expect(cache.get(URL_)!.text).toBe('NEW');
    expect(cache.keys()).toEqual([URL_]);
  });

  it('二进制与失败响应不写缓存，行为与旧版一致', async () => {
    const cache = createMemoryWebFetchCache();
    const d = deps('%PDF-1.4', cache);
    d.fetchImpl = vi.fn(async () => ({
      ok: true, status: 200, statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/pdf' }),
      text: async () => '%PDF-1.4',
    })) as unknown as typeof fetch;
    const r = await executeWebFetch(JSON.stringify({ url: URL_ }), d);
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('二进制内容');
    expect(cache.get(URL_)).toBeUndefined();
  });
});

describe('web_cache_read：slice', () => {
  it('逐段翻页可还原全文，每段观察都不超过上限', async () => {
    const text = Array.from({ length: 300 }, (_, i) => `line ${i}: ${'x'.repeat(30)}`).join('\n');
    const cache = await fetchInto(text);
    let offset = 0;
    let joined = '';
    let rounds = 0;
    while (offset < text.length && rounds < 100) {
      const r = executeWebCacheRead(JSON.stringify({ url: URL_, mode: 'slice', offset }), cache);
      rounds++;
      expect(r.ok).toBe(true);
      expect(r.observation.length).toBeLessThanOrEqual(BUDGET);
      expect(r.preparatory).toBe(true);
      const m = /本段起点 (\d+)，长度 (\d+)，范围 \[(\d+), (\d+)\)/.exec(r.observation);
      expect(m).not.toBeNull();
      const start = Number(m![1]);
      const end = Number(m![4]);
      const footStart = r.observation.lastIndexOf('\n[本段起点');
      const headAndBody = r.observation.slice(0, footStart);
      const body = headAndBody.slice(headAndBody.length - Number(m![2]));
      expect(body).toBe(text.slice(start, end));
      joined += body;
      offset = end;
    }
    expect(joined).toBe(text);
  });

  it('显式 length 超预算时按上限收口，footer 提示仍完整', async () => {
    const cache = await fetchInto('A'.repeat(5000));
    const r = executeWebCacheRead(
      JSON.stringify({ url: URL_, mode: 'slice', length: 99999 }), cache,
    );
    expect(r.ok).toBe(true);
    expect(r.observation.length).toBeLessThanOrEqual(BUDGET);
    expect(r.observation).toContain('[本段起点');
  });

  it('短正文 / 空正文不产生负长度或空 footer', async () => {
    const cache = await fetchInto('');
    const r = executeWebCacheRead(JSON.stringify({ url: URL_, mode: 'slice' }), cache);
    expect(r.observation.length).toBeLessThanOrEqual(BUDGET);
    // observation 与 detail 是两段不同文本：前者给模型看（明确指路减小 offset），
    // 后者是回执。原断言把 detail 里的措辞误安到 observation 上，这里两头都锁。
    expect(r.observation).toContain('[起点已到正文末尾，请减小 offset]');
    expect(r.detail).toContain('已在末尾');
  });
});

describe('web_cache_read：grep / info / 参数', () => {
  it('grep 逐行匹配并带上下文、count 只回计数', async () => {
    const cache = await fetchInto('alpha\nbeta 2027\ngamma\nbeta 2028\n');
    const g = executeWebCacheRead(
      JSON.stringify({ url: URL_, mode: 'grep', pattern: 'beta', before: 1, after: 1 }), cache,
    );
    expect(g.ok).toBe(true);
    expect(g.observation.length).toBeLessThanOrEqual(BUDGET);
    expect(g.observation).toContain('beta 2027');
    expect(g.observation).toContain('beta 2028');
    expect(g.detail).toContain('命中 2 行');
    const c = executeWebCacheRead(
      JSON.stringify({ url: URL_, mode: 'grep', pattern: 'beta', count: true }), cache,
    );
    expect(c.observation).toContain('命中 2 行');
    expect(c.observation).not.toContain('>');
  });

  it('命中行装不进预算时明确判失败并指路 slice，不静默丢数据', async () => {
    const cache = await fetchInto(`head\n${'X'.repeat(BUDGET * 2)}\ntail\n`);
    const g = executeWebCacheRead(
      JSON.stringify({ url: URL_, mode: 'grep', pattern: '^X+$', before: 2, after: 2 }), cache,
    );
    expect(g.ok).toBe(false);
    expect(g.observation).toContain('mode=slice');
  });

  it('info 回元信息；未缓存 URL 给出明确提示', async () => {
    const cache = await fetchInto('abc');
    const i = executeWebCacheRead(JSON.stringify({ url: URL_, mode: 'info' }), cache);
    expect(i.observation).toContain('3 字符');
    const miss = executeWebCacheRead(
      JSON.stringify({ url: 'https://example.com/other', mode: 'info' }), cache,
    );
    expect(miss.ok).toBe(false);
    expect(miss.observation).toContain('请先调用 web_fetch');
  });

  it('参数校验：非法正则 / g,y 标志 / 非法数值 / 缺 pattern', async () => {
    const cache = await fetchInto('abc');
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ url: URL_, mode: 'grep', pattern: '[' }, '不是合法正则'],
      [{ url: URL_, mode: 'grep', pattern: 'a', flags: 'g' }, 'flags'],
      [{ url: URL_, mode: 'grep', pattern: 'a', limit: 0 }, 'limit'],
      [{ url: URL_, mode: 'grep', pattern: 'a', before: -1 }, 'before'],
      [{ url: URL_, mode: 'grep' }, 'pattern'],
      [{ url: URL_, mode: 'slice', offset: -1 }, 'offset'],
      [{ url: URL_, mode: 'wat' }, 'mode'],
    ];
    for (const [args, keyword] of cases) {
      const r = executeWebCacheRead(JSON.stringify(args), cache);
      expect(r.ok, JSON.stringify(args)).toBe(false);
      expect(r.observation, JSON.stringify(args)).toContain(keyword);
    }
  });

  it('URL 规范化：尾部斜杠差异仍能命中同一份缓存', async () => {
    const cache = createMemoryWebFetchCache();
    await executeWebFetch(
      JSON.stringify({ url: 'https://example.com' }), deps('abc', cache),
    );
    const key = cache.keys()[0]!;
    const r = executeWebCacheRead(JSON.stringify({ url: 'https://example.com/', mode: 'info' }), cache);
    expect(r.ok).toBe(true);
    expect(key).toBe('https://example.com/');
  });

  it('所有读取结果都标 preparatory，不消耗自主决策轮数', async () => {
    const cache = await fetchInto('abc');
    for (const mode of ['info', 'slice', 'grep']) {
      const args: Record<string, unknown> = { url: URL_, mode };
      if (mode === 'grep') args['pattern'] = 'a';
      expect(executeWebCacheRead(JSON.stringify(args), cache).preparatory).toBe(true);
    }
  });
});
