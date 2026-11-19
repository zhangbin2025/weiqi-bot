import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAICompatibleClient } from '../OpenAICompatibleClient';
import { installLLMProxy, resetLLMProxyUrl } from '../LLMProxyUrl';

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
      .rejects.toThrow(/思考过程占满了 token 预算/);
    await expect(client().chat([{ role: 'user', content: 'x' }]))
      .rejects.toThrow(/maxtokens/);
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
    expect(body.max_tokens).toBe(4096);
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


describe('真截断（content 为空 + finish_reason=length）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const client = () => new OpenAICompatibleClient({
    baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'm',
  });

  it('报错指向 maxtokens，不再误导用户调 timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => '',
      json: async () => ({
        choices: [{
          message: { content: '', reasoning_content: '我需要判断意图……' },
          finish_reason: 'length',
        }],
        usage: { completion_tokens: 1024, completion_tokens_details: { reasoning_tokens: 1024 } },
      }),
    })));
    await expect(client().chat([{ role: 'user', content: '什么叫倒脱靴' }]))
      .rejects.toThrow(/maxtokens/);
    await expect(client().chat([{ role: 'user', content: '什么叫倒脱靴' }]))
      .rejects.not.toThrow(/llm timeout/);
  });

  it('maxTokens 可自定义并透传到请求体', async () => {
    const spy = vi.fn(async () => ({
      ok: true, status: 200, text: async () => '',
      json: async () => completion('{}', 'stop'),
    }));
    vi.stubGlobal('fetch', spy);
    const c = new OpenAICompatibleClient({
      baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'm', maxTokens: 8192,
    });
    await c.chat([{ role: 'user', content: 'x' }]);
    const body = JSON.parse((spy.mock.calls[0] as any)[1].body as string);
    expect(body.max_tokens).toBe(8192);
  });
});


describe('CORS 修复：LLM 请求走 /proxy 反向代理', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetLLMProxyUrl();
  });

  const ENDPOINT = 'https://tokenhub.tencentmaas.com/plan/v3/chat/completions';
  const mkClient = () => new OpenAICompatibleClient({
    baseUrl: 'https://tokenhub.tencentmaas.com/plan/v3',
    apiKey: 'test-key',
    model: 'test-model',
  });

  it('登记代理后 fetch 的是同源代理 URL，不再是云端端点', async () => {
    installLLMProxy('https://api.weiqi.lol');
    const spy = vi.fn(async () => ({
      ok: true, status: 200, text: async () => '',
      json: async () => completion('{}', 'stop'),
    }));
    vi.stubGlobal('fetch', spy);
    await mkClient().chat([{ role: 'user', content: 'hi' }]);
    expect(spy.mock.calls[0]![0]).toBe(
      `https://api.weiqi.lol/?url=${encodeURIComponent(ENDPOINT)}`,
    );
  });

  it('走代理时 POST / Authorization / JSON body 逐字不变', async () => {
    installLLMProxy('https://api.weiqi.lol');
    const spy = vi.fn(async () => ({
      ok: true, status: 200, text: async () => '',
      json: async () => completion('{}', 'stop'),
    }));
    vi.stubGlobal('fetch', spy);
    await mkClient().chat([{ role: 'user', content: 'hi' }]);
    const init = spy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string).model).toBe('test-model');
  });

  it('未登记代理时仍直连原端点（改动前行为，供测试 / CLI 宿主保留）', async () => {
    const spy = vi.fn(async () => ({
      ok: true, status: 200, text: async () => '',
      json: async () => completion('{}', 'stop'),
    }));
    vi.stubGlobal('fetch', spy);
    await mkClient().chat([{ role: 'user', content: 'hi' }]);
    expect(spy.mock.calls[0]![0]).toBe(ENDPOINT);
  });

  it('400 降级重试也走同一个代理 URL（不会重试时退回直连）', async () => {
    installLLMProxy('https://api.weiqi.lol');
    const spy = vi.fn()
      .mockImplementationOnce(async () => ({
        ok: false, status: 400, text: async () => 'unsupported field: reasoning_effort',
      }))
      .mockImplementationOnce(async () => ({
        ok: true, status: 200, text: async () => '',
        json: async () => completion('{}', 'stop'),
      }));
    vi.stubGlobal('fetch', spy);
    await mkClient().chat([{ role: 'user', content: 'hi' }]);
    expect(spy).toHaveBeenCalledTimes(2);
    const expected = `https://api.weiqi.lol/?url=${encodeURIComponent(ENDPOINT)}`;
    expect(spy.mock.calls[0]![0]).toBe(expected);
    expect(spy.mock.calls[1]![0]).toBe(expected);
  });
});


describe('reasoning_effort 关闭思考', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const mk = (extra: any = {}) => new OpenAICompatibleClient({
    baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'm', ...extra,
  });
  const mockOk = () => vi.fn(async () => ({
    ok: true, status: 200, text: async () => '',
    json: async () => completion('{}', 'stop'),
  }));

  it('默认发送 reasoning_effort: none', async () => {
    const spy = mockOk(); vi.stubGlobal('fetch', spy);
    await mk().chat([{ role: 'user', content: 'hi' }]);
    const body = JSON.parse((spy.mock.calls[0] as any)[1].body as string);
    expect(body.reasoning_effort).toBe('none');
  });

  it('disableThinking: false 时不发该字段', async () => {
    const spy = mockOk(); vi.stubGlobal('fetch', spy);
    await mk({ disableThinking: false }).chat([{ role: 'user', content: 'hi' }]);
    const body = JSON.parse((spy.mock.calls[0] as any)[1].body as string);
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('端点不认 reasoning_effort 报 400 → 自动去掉重试一次', async () => {
    const spy = vi.fn()
      .mockImplementationOnce(async () => ({
        ok: false, status: 400, text: async () => 'unsupported field: reasoning_effort',
      }))
      .mockImplementationOnce(async () => ({
        ok: true, status: 200, text: async () => '',
        json: async () => completion('{"intent":"chat"}', 'stop'),
      }));
    vi.stubGlobal('fetch', spy);
    const r = await mk().chat([{ role: 'user', content: 'hi' }]);
    expect(r.content).toContain('chat');
    expect(spy).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse((spy.mock.calls[1] as any)[1].body as string);
    expect(retryBody.reasoning_effort).toBeUndefined();
  });

  it('无关的 400 不误触发降级，直接报错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 400, text: async () => 'invalid model',
    })));
    await expect(mk().chat([{ role: 'user', content: 'hi' }]))
      .rejects.toThrow(/HTTP 400/);
  });

  it('回归：json mode 400 降级仍保留 reasoning_effort', async () => {
    const spy = vi.fn()
      .mockImplementationOnce(async () => ({
        ok: false, status: 400, text: async () => 'response_format not supported',
      }))
      .mockImplementationOnce(async () => ({
        ok: true, status: 200, text: async () => '',
        json: async () => completion('{}', 'stop'),
      }));
    vi.stubGlobal('fetch', spy);
    await mk().chat([{ role: 'user', content: 'hi' }]);
    expect(spy).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse((spy.mock.calls[1] as any)[1].body as string);
    expect(retryBody.response_format).toBeUndefined();
    expect(retryBody.reasoning_effort).toBe('none');
  });
});
