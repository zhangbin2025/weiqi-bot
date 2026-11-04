import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAICompatibleClient } from '../OpenAICompatibleClient';

function mockFetchOnce(payload: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  })));
}

function completion(content: string, finishReason: string) {
  return {
    choices: [{ message: { content }, finish_reason: finishReason }],
  };
}

describe('OpenAICompatibleClient 截断标记', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const client = () => new OpenAICompatibleClient({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    model: 'test-model',
  });

  it('正常完成：truncated=false', async () => {
    mockFetchOnce(completion('{"intent":"chat","reply":"你好"}', 'stop'));
    const r = await client().chat([{ role: 'user', content: 'hi' }]);
    expect(r.content).toBe('{"intent":"chat","reply":"你好"}');
    expect(r.truncated).toBe(false);
  });

  it('回归：finish_reason=length 但 content 是完整 JSON 时不再误报截断', async () => {
    // 推理模型常见形态：reasoning_content 被预算掐断，但 content 里的 JSON 已写完
    mockFetchOnce({
      choices: [{
        message: { content: '{"intent":"chat","reply":"双打吃是指一步棋同时打吃两块棋。"}', reasoning_content: '让我想想…' },
        finish_reason: 'length',
      }],
    });
    const r = await client().chat([{ role: 'user', content: '什么叫双打吃' }]);
    expect(r.truncated).toBe(true);
    expect(() => JSON.parse(r.content)).not.toThrow();
  });

  it('finish_reason=length 且 content 为空 → 明确报截断', async () => {
    mockFetchOnce({
      choices: [{
        message: { content: '', reasoning_content: '正在思考' },
        finish_reason: 'length',
      }],
    });
    await expect(client().chat([{ role: 'user', content: 'x' }]))
      .rejects.toThrow(/输出被截断/);
  });

  it('content 为空、非截断、但只有思考过程 → 提示换非推理模型', async () => {
    mockFetchOnce({
      choices: [{
        message: { content: '', reasoning_content: '正在思考' },
        finish_reason: 'stop',
      }],
    });
    await expect(client().chat([{ role: 'user', content: 'x' }]))
      .rejects.toThrow(/只返回了思考过程/);
  });

  it('请求体带 max_tokens 与 response_format', async () => {
    const spy = vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => '',
      json: async () => completion('{}', 'stop'),
    }));
    vi.stubGlobal('fetch', spy);
    await client().chat([{ role: 'user', content: 'x' }]);
    const body = JSON.parse((spy.mock.calls[0] as any)[1].body as string);
    expect(body.max_tokens).toBe(1024);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.model).toBe('test-model');
  });

  it('不再硬编码兜底模型 gpt-4o-mini', async () => {
    const spy = vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => '',
      json: async () => completion('{}', 'stop'),
    }));
    vi.stubGlobal('fetch', spy);
    const noModel = new OpenAICompatibleClient({
      baseUrl: 'https://api.example.com/v1', apiKey: 'k',
    });
    await noModel.chat([{ role: 'user', content: 'x' }]);
    const body = JSON.parse((spy.mock.calls[0] as any)[1].body as string);
    expect(body.model).toBe('');
  });
});
