/**
 * 标准 tool-calling 链路契约测试
 * 锁住：tools 声明、tool_calls 解析、空 content 合法、不带 jsonMode、400 降级共享。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAICompatibleClient, type ToolDefinition } from '../OpenAICompatibleClient';

const TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_fetch',
    description: '取回网页',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
};

function stubFetch(payload: unknown, status = 200) {
  const spy = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

const client = () => new OpenAICompatibleClient({
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-key',
  model: 'test-model',
});

describe('OpenAICompatibleClient.chatWithTools', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('请求体带 tools + tool_choice=auto，且不带 response_format', async () => {
    const spy = stubFetch({ choices: [{ message: { content: '你好' }, finish_reason: 'stop' }] });
    await client().chatWithTools([{ role: 'user', content: 'hi' }], [TOOL]);
    const body = JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.tools).toEqual([TOOL]);
    expect(body.tool_choice).toBe('auto');
    expect(body.response_format).toBeUndefined();
    expect(body.stream).toBe(false);
  });

  it('模型返回 tool_calls 且 content 为空 → 合法中间状态，不抛错', async () => {
    stubFetch({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: 'call_1', type: 'function',
            function: { name: 'web_fetch', arguments: '{"url":"https://example.com/"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    });
    const r = await client().chatWithTools([{ role: 'user', content: '看看这个网页' }], [TOOL]);
    expect(r.content).toBe('');
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls![0]).toEqual({
      id: 'call_1', type: 'function',
      function: { name: 'web_fetch', arguments: '{"url":"https://example.com/"}' },
    });
  });

  it('缺 id / 缺 function.name 的坏 tool_call 被丢弃，避免回填坏 id', async () => {
    stubFetch({
      choices: [{
        message: {
          content: '',
          tool_calls: [
            { id: '', type: 'function', function: { name: 'web_fetch', arguments: '{}' } },
            { id: 'call_ok', type: 'function', function: { arguments: '{}' } },
            { id: 'call_valid', type: 'function', function: { name: 'web_fetch', arguments: '{}' } },
          ],
        },
        finish_reason: 'tool_calls',
      }],
    });
    const r = await client().chatWithTools([{ role: 'user', content: 'x' }], [TOOL]);
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls![0]!.id).toBe('call_valid');
  });

  it('无 tool_calls 时返回最终文本，toolCalls 省略', async () => {
    stubFetch({ choices: [{ message: { content: '这是答案' }, finish_reason: 'stop' }] });
    const r = await client().chatWithTools([{ role: 'user', content: 'x' }], [TOOL]);
    expect(r.content).toBe('这是答案');
    expect(r.toolCalls).toBeUndefined();
  });

  it('role=tool 消息原样进 payload（agent loop 观察回填）', async () => {
    const spy = stubFetch({ choices: [{ message: { content: '归纳完毕' }, finish_reason: 'stop' }] });
    await client().chatWithTools([
      { role: 'assistant', content: '', tool_calls: [{
        id: 'c1', type: 'function', function: { name: 'web_fetch', arguments: '{}' },
      }] },
      { role: 'tool', content: '网页内容', tool_call_id: 'c1' },
    ], [TOOL]);
    const body = JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.messages[0].tool_calls[0].id).toBe('c1');
    expect(body.messages[1]).toMatchObject({ role: 'tool', content: '网页内容', tool_call_id: 'c1' });
  });

  it('chat() 旧链路行为不变：空 content 仍抛错', async () => {
    stubFetch({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] });
    await expect(client().chat([{ role: 'user', content: 'x' }])).rejects.toThrow('LLM 返回内容为空');
  });
});
