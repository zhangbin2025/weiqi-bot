import { describe, it, expect, vi } from 'vitest';
import { createFetchBatchPrimitive } from '../FetchBatchPrimitive';

function deps() {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify({ target: String(input) }),
  })) as unknown as typeof fetch;
  return { proxyUrl: 'https://proxy.example', timeoutMs: 5_000, fetchImpl };
}

describe('fetch_batch', () => {
  it('按输入顺序抓取 URL 列表并把 JSON 结果作为结构化 value 返回', async () => {
    const d = deps();
    const primitive = createFetchBatchPrimitive(d);
    const result = await primitive.execute({
      requests: [
        { url: 'https://example.com/api', query: { uid: '100', page: '1' } },
        { url: 'https://example.org/list?page=2' },
      ],
    });
    expect(result.ok).toBe(true);
    expect(d.fetchImpl).toHaveBeenCalledTimes(2);
    const values = result.value as Array<{ url: string; ok: boolean; value: { target: string } }>;
    expect(values).toHaveLength(2);
    expect(values[0]!.url).toBe('https://example.com/api?uid=100&page=1');
    expect(values[0]!.ok).toBe(true);
    expect(values[0]!.value.target).toContain(encodeURIComponent('https://example.com/api?uid=100&page=1'));
    expect(values[1]!.url).toBe('https://example.org/list?page=2');
  });

  it('单项失败不丢失其它结果，保留输入顺序', async () => {
    const d = deps();
    d.fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target.includes('bad.example')) throw new Error('network down');
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => '{"ok":true}',
      };
    }) as unknown as typeof fetch;
    const result = await createFetchBatchPrimitive(d).execute({
      requests: [
        { url: 'https://bad.example/' },
        { url: 'https://good.example/' },
      ],
    });
    expect(result.ok).toBe(false);
    const values = result.value as Array<{ ok: boolean; detail: string; value: unknown }>;
    expect(values[0]!.ok).toBe(false);
    expect(values[0]!.detail).toContain('network down');
    expect(values[0]!.value).toBeNull();
    expect(values[1]!.ok).toBe(true);
    expect(values[1]!.value).toEqual({ ok: true });
  });
});
