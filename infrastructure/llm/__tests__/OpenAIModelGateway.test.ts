/**
 * 模型网关的「能力闸门」测试
 *
 * 只验证放行/拒绝的边界，不发起真实网络请求：
 * - 未知 task 直接抛错，且不读凭据、不构造客户端
 * - chat.reply 与 plugin.generate 都放行，走同一套 chat completions
 * - jsonMode 默认 false（对话/插件生成都是纯文本），显式传 true 时透传
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted：保证这些 stub 在 vi.mock 工厂（会被提升到文件顶部）执行前就绪。
const mocks = vi.hoisted(() => ({
  chat: vi.fn().mockResolvedValue({ content: 'ok', truncated: false }),
  loadConfig: vi.fn<() => { baseUrl: string; model: string } | null>(
    () => ({ baseUrl: 'https://example.test/v1', model: 'm' }),
  ),
  loadApiKey: vi.fn<() => string | null>(() => 'sk-test'),
}));

// 路径相对本测试文件：../ = infrastructure/llm/，与被测模块里的 './XXX' 解析到同一文件。
vi.mock('../LLMCredentialStore', () => ({
  loadLLMConfig: () => mocks.loadConfig(),
  loadApiKey: () => mocks.loadApiKey(),
}));

vi.mock('../OpenAICompatibleClient', () => ({
  OpenAICompatibleClient: class {
    chat = mocks.chat;
  },
}));

import { OpenAIModelGateway } from '../OpenAIModelGateway';

function req(task: string, jsonMode?: boolean) {
  return {
    task,
    messages: [{ role: 'user' as const, content: 'hi' }],
    ...(jsonMode !== undefined ? { options: { jsonMode } } : {}),
  };
}

describe('OpenAIModelGateway 能力闸门', () => {
  beforeEach(() => {
    mocks.chat.mockClear().mockResolvedValue({ content: 'ok', truncated: false });
    mocks.loadConfig.mockClear().mockReturnValue({ baseUrl: 'https://example.test/v1', model: 'm' });
    mocks.loadApiKey.mockClear().mockReturnValue('sk-test');
  });

  it('未知 task 直接报错，且完全不读凭据/不发请求', async () => {
    const gw = new OpenAIModelGateway();
    await expect(gw.execute(req('ocr.image'))).rejects.toThrow('尚未实现');
    await expect(gw.execute(req('doc.table'))).rejects.toThrow('尚未实现');
    expect(mocks.loadConfig).not.toHaveBeenCalled();
    expect(mocks.loadApiKey).not.toHaveBeenCalled();
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it('chat.reply 放行，默认非 JSON 模式', async () => {
    const gw = new OpenAIModelGateway();
    const r = await gw.execute(req('chat.reply'));
    expect(r).toEqual({ text: 'ok', truncated: false });
    expect(mocks.chat).toHaveBeenCalledTimes(1);
    expect(mocks.chat.mock.calls[0]![1]).toEqual({ jsonMode: false });
  });

  it('plugin.generate 放行（插件生成/修复循环共用纯文本链路）', async () => {
    const gw = new OpenAIModelGateway();
    const r = await gw.execute(req('plugin.generate'));
    expect(r.text).toBe('ok');
    expect(mocks.chat.mock.calls[0]![1]).toEqual({ jsonMode: false });
  });

  it('显式 jsonMode 透传', async () => {
    const gw = new OpenAIModelGateway();
    await gw.execute(req('plugin.generate', true));
    expect(mocks.chat.mock.calls[0]![1]).toEqual({ jsonMode: true });
  });

  it('isReady 需要配置 + 模型 + 可解密的 key', () => {
    const gw = new OpenAIModelGateway();
    expect(gw.isReady()).toBe(true);
    mocks.loadApiKey.mockReturnValueOnce(null);
    expect(gw.isReady()).toBe(false);
    mocks.loadConfig.mockReturnValueOnce(null);
    expect(gw.isReady()).toBe(false);
  });
});
