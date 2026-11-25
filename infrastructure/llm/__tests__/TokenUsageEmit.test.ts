import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAICompatibleClient } from '../OpenAICompatibleClient';
import { onTokenUsage, resetTokenUsageObserversForTest } from '../../../application/token/TokenUsageSink';
import type { TokenUsageRecord } from '../../../application/token/TokenUsageTypes';

function mockFetchOnce(payload: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  })));
}

const client = () => new OpenAICompatibleClient({
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-key',
  model: 'test-model',
  task: 'chat.reply',
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetTokenUsageObserversForTest();
});

describe('OpenAICompatibleClient token 用量埋点', () => {
  it('正常 usage 逐字上报，provider 取原始 host 而非代理地址', async () => {
    const seen: TokenUsageRecord[] = [];
    onTokenUsage((r) => seen.push(r));
    mockFetchOnce({
      choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 },
    });
    await client().chat([{ role: 'user', content: 'hi' }]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.provider).toBe('api.example.com');
    expect(seen[0]!.endpoint).toBe('https://api.example.com/v1/chat/completions');
    expect(seen[0]!.model).toBe('test-model');
    expect(seen[0]!.task).toBe('chat.reply');
    expect(seen[0]!.promptTokens).toBe(123);
    expect(seen[0]!.completionTokens).toBe(45);
    expect(seen[0]!.totalTokens).toBe(168);
    expect(seen[0]!.reported).toBe(true);
  });

  it('缺 total_tokens 时合计 = 上行 + 下行', async () => {
    const seen: TokenUsageRecord[] = [];
    onTokenUsage((r) => seen.push(r));
    mockFetchOnce({
      choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 3 },
    });
    await client().chat([{ role: 'user', content: 'hi' }]);
    expect(seen[0]!.totalTokens).toBe(13);
  });

  it('端点完全没返回 usage：token 记 0、reported=false，不估算', async () => {
    const seen: TokenUsageRecord[] = [];
    onTokenUsage((r) => seen.push(r));
    mockFetchOnce({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] });
    await client().chat([{ role: 'user', content: 'hi' }]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.reported).toBe(false);
    expect(seen[0]!.totalTokens).toBe(0);
  });

  it('HTTP 失败不记；成功但上层判「内容为空」仍记（请求确实发生了）', async () => {
    const seen: TokenUsageRecord[] = [];
    onTokenUsage((r) => seen.push(r));
    mockFetchOnce({ error: 'bad' }, 500);
    await expect(client().chat([{ role: 'user', content: 'hi' }])).rejects.toThrow();
    expect(seen).toHaveLength(0);

    mockFetchOnce({
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 8, completion_tokens: 0, total_tokens: 8 },
    });
    await expect(client().chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/内容为空/);
    expect(seen).toHaveLength(1);
  });

  it('400 降级重试只记最终成功那一次', async () => {
    const seen: TokenUsageRecord[] = [];
    onTokenUsage((r) => seen.push(r));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false, status: 400,
        text: async () => 'unsupported field: reasoning_effort',
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        text: async () => '',
        json: async () => ({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    await client().chat([{ role: 'user', content: 'hi' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seen).toHaveLength(1);
  });

  it('超时 / 网络错误（fetch 抛错）不记任何 token', async () => {
    const seen: TokenUsageRecord[] = [];
    onTokenUsage((r) => seen.push(r));
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    await expect(client().chat([{ role: 'user', content: 'hi' }])).rejects.toThrow();
    expect(seen).toHaveLength(0);
  });

  it('response.json() 解析抛错不记（请求无法确认成功）', async () => {
    const seen: TokenUsageRecord[] = [];
    onTokenUsage((r) => seen.push(r));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => '',
      json: async () => { throw new Error('bad json'); },
    })));
    await expect(client().chat([{ role: 'user', content: 'hi' }])).rejects.toThrow();
    expect(seen).toHaveLength(0);
  });

  it('usage 脏值（负数 / NaN / 字符串）归一成 0，不污染合计', async () => {
    const seen: TokenUsageRecord[] = [];
    onTokenUsage((r) => seen.push(r));
    mockFetchOnce({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: -5, completion_tokens: 'oops', total_tokens: NaN },
    });
    await client().chat([{ role: 'user', content: 'hi' }]);
    expect(seen[0]!.promptTokens).toBe(0);
    expect(seen[0]!.completionTokens).toBe(0);
    expect(seen[0]!.totalTokens).toBe(0);
    expect(seen[0]!.reported).toBe(true);
  });

  it('未注册观察者时 emit 是空操作，不改变请求行为', async () => {
    mockFetchOnce({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
    const r = await client().chat([{ role: 'user', content: 'hi' }]);
    expect(r.content).toBe('ok');
  });
});
