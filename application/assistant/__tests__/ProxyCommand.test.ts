import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isProxyCommand, handleProxyCommand } from '../ProxyCommand';
import { loadWebProxyOverride } from '../../../infrastructure/config/WebProxyOverride';
import { resolveLLMRequestUrl, resetLLMProxyUrl } from '../../../infrastructure/llm/LLMProxyUrl';

function installMemoryLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size; },
  });
}

function makeDeps() {
  const rendered: string[] = [];
  return {
    rendered,
    deps: { renderMessage: async (content: string) => { rendered.push(content); } },
  };
}

describe('isProxyCommand', () => {
  it('匹配主命令，大小写不敏感；不匹配其它', () => {
    expect(isProxyCommand('/proxy status')).toBe(true);
    expect(isProxyCommand('  /PROXY https://X  ')).toBe(true);
    expect(isProxyCommand('/proxy2 x')).toBe(false);
    expect(isProxyCommand('/help')).toBe(false);
  });
});

describe('handleProxyCommand', () => {
  beforeEach(() => { installMemoryLocalStorage(); resetLLMProxyUrl(); });
  afterEach(() => { vi.unstubAllGlobals(); resetLLMProxyUrl(); });

  it('非 /proxy 返回 false', async () => {
    const { deps } = makeDeps();
    expect(await handleProxyCommand('/help', deps)).toBe(false);
  });

  it('App/桌面环境直接拦截：不写覆盖值、不改 LLM 代理', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla WeiqiApp/1.0' });
    const { rendered, deps } = makeDeps();
    expect(await handleProxyCommand('/proxy https://x.com', deps)).toBe(true);
    expect(loadWebProxyOverride()).toBeNull();
    expect(rendered[rendered.length - 1]).toContain('仅用于纯 Web');
    // 注册表保持未登记（直连），没有被 install 成 x.com
    const endpoint = 'https://llm.example/v1/chat/completions';
    expect(await resolveLLMRequestUrl(endpoint)).toBe(endpoint);
  });

  it('/proxy 与 /proxy status 显示当前状态', async () => {
    const { rendered, deps } = makeDeps();
    expect(await handleProxyCommand('/proxy', deps)).toBe(true);
    expect(rendered[rendered.length - 1]).toContain('未设置覆盖值');
    expect(await handleProxyCommand('/proxy status', deps)).toBe(true);
    expect(rendered[rendered.length - 1]).toContain('未设置覆盖值');
  });

  it('/proxy <url> 持久化并即时切换 LLM 代理，保留大小写', async () => {
    const { rendered, deps } = makeDeps();
    expect(await handleProxyCommand('/proxy https://MY.Proxy.DEV/V1', deps)).toBe(true);
    expect(loadWebProxyOverride()).toBe('https://MY.Proxy.DEV/V1');
    expect(rendered[rendered.length - 1]).toContain('https://MY.Proxy.DEV/V1');
    const endpoint = 'https://llm.example/v1/chat/completions';
    expect(await resolveLLMRequestUrl(endpoint)).toBe(
      `https://MY.Proxy.DEV/V1/?url=${encodeURIComponent(endpoint)}`,
    );
  });

  it('非法 URL 不写入、给出错误提示', async () => {
    const { rendered, deps } = makeDeps();
    expect(await handleProxyCommand('/proxy ftp://x.com', deps)).toBe(true);
    expect(loadWebProxyOverride()).toBeNull();
    expect(rendered[rendered.length - 1]).toContain('设置失败');
  });

  it('带空格的参数被拒绝', async () => {
    const { rendered, deps } = makeDeps();
    expect(await handleProxyCommand('/proxy https://x.com extra', deps)).toBe(true);
    expect(loadWebProxyOverride()).toBeNull();
    expect(rendered[rendered.length - 1]).toContain('不能包含空格');
  });

  it('/proxy reset 清除覆盖值', async () => {
    const { rendered, deps } = makeDeps();
    await handleProxyCommand('/proxy https://x.com', deps);
    expect(loadWebProxyOverride()).toBe('https://x.com');
    expect(await handleProxyCommand('/proxy reset', deps)).toBe(true);
    expect(loadWebProxyOverride()).toBeNull();
    expect(rendered[rendered.length - 1]).toContain('已清除');
  });
});
