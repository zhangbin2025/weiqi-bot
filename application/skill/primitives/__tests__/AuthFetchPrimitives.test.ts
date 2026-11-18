/**
 * 通用带凭据直连原语：模型无法把 token 发到白名单外，也永远看不到明文。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createAuthFetchPrimitives, createSecretSpecRegistry, validateAuthUrl,
  HTTP_FETCH_AUTH_TOOL_NAME, SECRET_PROMPT_TOOL_NAME, SECRET_PROMPT_SCHEME,
} from '../AuthFetchPrimitives';
import { createMemoryWebFetchCache } from '../../../../application/chat/WebFetchCache';
import type { SecretSpec } from '../../../SecretSpec';

const GH: SecretSpec = {
  key: 'github_token',
  label: 'GitHub Token',
  setupUrl: 'https://github.com/settings/tokens',
  allowedHosts: ['api.github.com'],
  header: { name: 'Authorization', prefix: 'Bearer ' },
};

function jsonResponse(status: number, body: string, headers: Record<string, string> = {}): Response {
  return {
    status, statusText: status === 200 ? 'OK' : 'ERR', ok: status >= 200 && status < 300,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => body,
  } as unknown as Response;
}

function setup(opts: {
  token?: unknown;
  response?: Response;
  specs?: SecretSpec[];
  onReadRaw?: () => void;
} = {}) {
  const cache = createMemoryWebFetchCache();
  const fetchImpl = vi.fn(async () => opts.response ?? jsonResponse(200, '{"ok":true}'));
  const kv = {
    readRaw: vi.fn(async (_domain: string, _key: string) => {
      opts.onReadRaw?.();
      return opts.token ?? null;
    }),
  };
  const specs = createSecretSpecRegistry(opts.specs ?? [GH]);
  const prims = createAuthFetchPrimitives({
    kv: kv as never, specs, cache, fetchImpl: fetchImpl as never, timeoutMs: 1000,
  });
  const auth = prims.find((p) => p.name === HTTP_FETCH_AUTH_TOOL_NAME)!;
  const prompt = prims.find((p) => p.name === SECRET_PROMPT_TOOL_NAME)!;
  return { auth, prompt, fetchImpl, kv, cache, specs };
}

const call = (url: string, secretKey = 'github_token') =>
  JSON.stringify({ url, secretKey });

describe('validateAuthUrl（host 白名单由配方声明，模型无法扩张）', () => {
  it('只收 https、host 精确匹配、禁 userinfo / 端口 / 片段', () => {
    expect(validateAuthUrl('https://api.github.com/user?per_page=30', GH))
      .toBe('https://api.github.com/user?per_page=30');
    expect(validateAuthUrl('https://API.GITHUB.COM/user', GH))
      .toBe('https://api.github.com/user');
  });
  it('拒绝白名单外的 host（含相似域名 / 子域 / 协议降级 / 带端口）', () => {
    for (const u of [
      'https://evil.com/user',
      'https://api.github.com.evil.com/user',
      'https://sub.api.github.com/user',
      'http://api.github.com/user',
      'https://api.github.com:8443/user',
      'https://user:pw@api.github.com/user',
      'https://api.github.com/user#frag',
    ]) expect(() => validateAuthUrl(u, GH)).toThrow();
  });
});

describe('http_fetch_auth', () => {
  it('两个工具名固定，参数只有 url / secretKey（没有 header / hosts 参数）', async () => {
    const { auth, prompt } = setup();
    expect(Object.keys(auth.definition.parameters.properties as object)).toEqual(['url', 'secretKey']);
    expect(auth.definition.parameters.additionalProperties).toBe(false);
    expect(prompt.definition.parameters.properties).toHaveProperty('secretKey');
  });

  it('规格表里没有的 key：不发请求、不读凭据，明确拒绝', async () => {
    const { auth, fetchImpl, kv } = setup();
    const r = await auth.execute(call('https://api.github.com/user', 'not_declared'));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('未知凭据');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(kv.readRaw).not.toHaveBeenCalled();
  });

  it('白名单外 URL：在读凭据之前就拒绝，绝不把 token 发出去', async () => {
    const { auth, fetchImpl, kv } = setup({ token: 'ghp_SECRET_TOKEN_1234' });
    const r = await auth.execute(call('https://evil.com/steal'));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('参数无效');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(kv.readRaw).not.toHaveBeenCalled();
  });

  it('凭据未配置：回 secret-prompt 链接，观察里没有任何明文', async () => {
    const { auth, fetchImpl } = setup({ token: null });
    const r = await auth.execute(call('https://api.github.com/user'));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain(`${SECRET_PROMPT_SCHEME}github_token`);
    expect(r.observation).toContain('只把下面这条链接原样贴给用户');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('401 = 重认证：回同一条配置链接，不发第二次请求', async () => {
    const { auth, fetchImpl } = setup({
      token: 'ghp_EXPIRED_TOKEN_1234', response: jsonResponse(401, '{"message":"Bad credentials"}'),
    });
    const r = await auth.execute(call('https://api.github.com/user'));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('401');
    expect(r.observation).toContain(`${SECRET_PROMPT_SCHEME}github_token`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('403 限流不是失效：如实回状态，不误叫用户重配', async () => {
    const { auth } = setup({ token: 'ghp_VALID_TOKEN_1234', response: jsonResponse(403, 'rate limited') });
    const r = await auth.execute(call('https://api.github.com/user'));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('HTTP 403');
    expect(r.observation).not.toContain(SECRET_PROMPT_SCHEME);
  });

  it('成功：header 由配方声明拼出、credentials omit、观察/缓存/URL 都不含 token', async () => {
    const token = 'ghp_VALID_TOKEN_1234';
    const { auth, fetchImpl, cache } = setup({ token, response: jsonResponse(200, '{"login":"me"}') });
    const r = await auth.execute(call('https://api.github.com/user'));
    expect(r.ok).toBe(true);
    expect(r.preparatory).toBe(true);
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBe('no-store');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${token}`);
    // 明文只出现在 header 值里；观察、缓存、URL、detail 一律不含
    expect(r.observation).not.toContain(token);
    expect(r.detail).not.toContain(token);
    const cached = cache.get('https://api.github.com/user');
    expect(cached?.text).toBe('{"login":"me"}');
    expect(JSON.stringify(cached)).not.toContain(token);
  });

  it('长正文按 maxCharsPerMessage 收口并指路 web_cache_read，完整正文仍在缓存', async () => {
    const long = 'x'.repeat(9000);
    const { auth, cache } = setup({ token: 'ghp_VALID_TOKEN_1234', response: jsonResponse(200, long) });
    const r = await auth.execute(call('https://api.github.com/big'));
    expect(r.observation.length).toBeLessThanOrEqual(2000);
    expect(r.observation).toContain('web_cache_read');
    expect(r.observation).toContain('[预览 ');
    expect(r.observation).toContain('未到末尾');
    expect(cache.get('https://api.github.com/big')?.text).toBe(long);
  });

  it('规格表的 replace 生效：刷新成别的 host 后，旧的 GitHub URL 立刻被拒', async () => {
    const { auth, specs, fetchImpl } = setup({ token: 'ghp_VALID_TOKEN_1234' });
    specs.replace([{ ...GH, allowedHosts: ['api.example.com'], header: { name: 'X-Key', prefix: 'Token ' } }]);
    const r = await auth.execute(call('https://api.github.com/user'));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain('参数无效');
    expect(fetchImpl).not.toHaveBeenCalled();
    // 新 host 用新的 header 拼法
    const r2 = await auth.execute(call('https://api.example.com/me'));
    expect(r2.ok).toBe(true);
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Key']).toBe('Token ghp_VALID_TOKEN_1234');
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('readRaw 抛错 / fetch 抛错都如实回执，不编造正文', async () => {
    const bare = createAuthFetchPrimitives({
      kv: { readRaw: async () => { throw new Error('storage down'); } } as never,
      specs: createSecretSpecRegistry([GH]), cache: createMemoryWebFetchCache(),
      fetchImpl: (async () => jsonResponse(200, '{}')) as never, timeoutMs: 1000,
    });
    const a = bare.find((p) => p.name === HTTP_FETCH_AUTH_TOOL_NAME)!;
    expect((await a.execute(call('https://api.github.com/user'))).observation).toContain('读取本地凭据失败');

    const b = setup({ token: 'ghp_VALID_TOKEN_1234' });
    b.fetchImpl.mockRejectedValueOnce(new Error('CORS blocked'));
    expect((await b.auth.execute(call('https://api.github.com/user'))).observation)
      .toContain('CORS blocked');
  });
});

describe('secret_prompt（修改也弹框）', () => {
  it('无论是否已配置都回同一条链接（本原语不读存储）', async () => {
    const { prompt, kv } = setup({ token: 'ghp_ANY_TOKEN_1234' });
    const r = await prompt.execute(JSON.stringify({ secretKey: 'github_token' }));
    expect(r.ok).toBe(true);
    expect(r.observation).toContain(`${SECRET_PROMPT_SCHEME}github_token`);
    expect(r.observation).toContain('已有值会被覆盖');
    expect(kv.readRaw).not.toHaveBeenCalled();
  });

  it('规格表里没有的 key 拒绝弹框，防止模型编 key 骗输入框', async () => {
    const { prompt } = setup();
    const r = await prompt.execute(JSON.stringify({ secretKey: 'made_up' }));
    expect(r.ok).toBe(false);
    expect(r.observation).not.toContain(SECRET_PROMPT_SCHEME);
  });
});
