/**
 * LLM 代理注册表契约测试
 *
 * 锁住 2026-11-19 CORS 修复的核心行为：
 * - 未登记 = 直连（改动前行为逐字保留）
 * - 登记后按项目既有口径拼 ?url=<encodeURIComponent(端点)>
 * - Promise 注入：请求 await 同一个 Promise，不会先于注入发出
 * - 解析失败不静默降级成直连（纯 Web 直连必崩 CORS）
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  installLLMProxy, resetLLMProxyUrl, hasLLMProxyUrl, resolveLLMRequestUrl,
} from '../LLMProxyUrl';

const ENDPOINT = 'https://tokenhub.tencentmaas.com/plan/v3/chat/completions';

describe('resolveLLMRequestUrl', () => {
  afterEach(() => resetLLMProxyUrl());

  it('未登记代理时直连，行为与改动前一致', async () => {
    expect(hasLLMProxyUrl()).toBe(false);
    await expect(resolveLLMRequestUrl(ENDPOINT)).resolves.toBe(ENDPOINT);
  });

  it('登记纯 Web 代理后，端点整体编码进 ?url=（与 WebFetchTool 同口径）', async () => {
    installLLMProxy('https://api.weiqi.lol');
    expect(hasLLMProxyUrl()).toBe(true);
    await expect(resolveLLMRequestUrl(ENDPOINT)).resolves.toBe(
      `https://api.weiqi.lol/?url=${encodeURIComponent(ENDPOINT)}`,
    );
  });

  it('App 本地代理同样是拼 ?url=，不做任何特殊分支', async () => {
    installLLMProxy('http://127.0.0.1:8088/proxy');
    await expect(resolveLLMRequestUrl(ENDPOINT)).resolves.toBe(
      `http://127.0.0.1:8088/proxy/?url=${encodeURIComponent(ENDPOINT)}`,
    );
  });

  it('端点里已有的路径与 query 原样保留在编码后的 url 参数里', async () => {
    installLLMProxy('https://api.weiqi.lol');
    const withQuery = 'https://api.x.com/v1/chat/completions?foo=1&bar=2';
    const resolved = await resolveLLMRequestUrl(withQuery);
    const parsed = new URL(resolved);
    expect(parsed.searchParams.get('url')).toBe(withQuery);
  });

  it('空串 / undefined 登记 = 不启用代理（直连）', async () => {
    installLLMProxy('');
    await expect(resolveLLMRequestUrl(ENDPOINT)).resolves.toBe(ENDPOINT);
    installLLMProxy(undefined);
    await expect(resolveLLMRequestUrl(ENDPOINT)).resolves.toBe(ENDPOINT);
  });

  it('Promise 注入：请求会等解析完成，不会先于注入发出', async () => {
    let release: ((v: string) => void) | undefined;
    const pending = new Promise<string>((resolve) => { release = resolve; });
    installLLMProxy(pending);

    let settled = false;
    const request = resolveLLMRequestUrl(ENDPOINT).then((url) => { settled = true; return url; });
    await Promise.resolve(); // 让 await 先挂起
    expect(settled).toBe(false);

    release!('https://api.weiqi.lol');
    await expect(request).resolves.toBe(
      `https://api.weiqi.lol/?url=${encodeURIComponent(ENDPOINT)}`,
    );
  });

  it('解析失败不静默回落直连，而是抛清楚的错误', async () => {
    installLLMProxy(Promise.reject(new Error('bridge down')));
    await expect(resolveLLMRequestUrl(ENDPOINT)).rejects.toThrow(/代理地址解析失败/);
  });

  it('后登记覆盖先登记（幂等）', async () => {
    installLLMProxy('https://first.example');
    installLLMProxy('https://second.example');
    await expect(resolveLLMRequestUrl(ENDPOINT)).resolves.toBe(
      `https://second.example/?url=${encodeURIComponent(ENDPOINT)}`,
    );
  });

  it('reset 后回到直连', async () => {
    installLLMProxy('https://api.weiqi.lol');
    resetLLMProxyUrl();
    expect(hasLLMProxyUrl()).toBe(false);
    await expect(resolveLLMRequestUrl(ENDPOINT)).resolves.toBe(ENDPOINT);
  });
});
