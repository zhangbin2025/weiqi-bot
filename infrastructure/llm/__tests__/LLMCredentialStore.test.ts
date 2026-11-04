import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveLLMCredentials,
  loadLLMConfig,
  loadApiKey,
  clearLLMCredentials,
  maskApiKey,
  normalizeBaseUrl,
  buildChatCompletionsUrl,
} from '../LLMCredentialStore';

// 用内存 Map 模拟 localStorage（含 atob/btoa 由 Node 提供）
const store = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};

vi.stubGlobal('localStorage', localStorageMock);
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.getRandomValues) {
  // Node 环境兜底：走 Math.random 分支
  vi.stubGlobal('crypto', undefined);
}

beforeEach(() => store.clear());

describe('normalizeBaseUrl / buildChatCompletionsUrl', () => {
  it('去掉末尾斜杠', () => {
    expect(normalizeBaseUrl('https://api.x.com/v1///')).toBe('https://api.x.com/v1');
  });

  it('拒绝非 http(s)', () => {
    expect(() => normalizeBaseUrl('ftp://x.com')).toThrow(/http/);
  });

  it('/v1 补 chat/completions', () => {
    expect(buildChatCompletionsUrl('https://api.x.com/v1')).toBe('https://api.x.com/v1/chat/completions');
  });

  it('裸域名补 /v1/chat/completions', () => {
    expect(buildChatCompletionsUrl('https://api.x.com')).toBe('https://api.x.com/v1/chat/completions');
  });

  it('已含完整端点则不重复', () => {
    expect(buildChatCompletionsUrl('https://api.x.com/v1/chat/completions'))
      .toBe('https://api.x.com/v1/chat/completions');
  });

  it('用户贴完整端点时归一化掉尾段', () => {
    expect(normalizeBaseUrl('https://api.x.com/v1/chat/completions/'))
      .toBe('https://api.x.com/v1');
    expect(buildChatCompletionsUrl('https://api.x.com/v1/chat/completions'))
      .toBe('https://api.x.com/v1/chat/completions');
  });

  it('腾讯云 lkeap /v3 也能正确补端点', () => {
    expect(buildChatCompletionsUrl('https://api.lkeap.cloud.tencent.com/coding/v3'))
      .toBe('https://api.lkeap.cloud.tencent.com/coding/v3/chat/completions');
  });
});

describe('凭据加密存取（无需 Web Crypto）', () => {
  const KEY = 'sk-AbC-dEfGhIjKlMnOpQrStUvWxYz0123456789';

  it('保存后可解密回原 key，且 localStorage 里没有明文', () => {
    const cfg = saveLLMCredentials('https://api.x.com/v1', KEY, 'tc-code-latest');
    expect(cfg.model).toBe('tc-code-latest');
    expect(cfg.keyHint).toBe(maskApiKey(KEY));
    expect(loadApiKey()).toBe(KEY);

    const raw = JSON.stringify(Array.from(store.entries()));
    expect(raw).not.toContain(KEY);
    expect(raw).toContain('encryptedApiKey');
  });

  it('大小写敏感 / 特殊字符不丢失', () => {
    const weird = 'sk-Aa/Bb+Cc==Dd_Ee-123';
    saveLLMCredentials('https://api.x.com/v1', weird, 'my-model');
    expect(loadApiKey()).toBe(weird);
    expect(loadLLMConfig()?.model).toBe('my-model');
  });

  it('可修改模型而不丢 key', () => {
    saveLLMCredentials('https://api.x.com/v1', KEY);
    const cfg = loadLLMConfig()!;
    saveLLMCredentials(cfg.baseUrl, loadApiKey()!, 'qwen-plus');
    expect(loadLLMConfig()?.model).toBe('qwen-plus');
    expect(loadApiKey()).toBe(KEY);
  });

  it('off 后配置与密钥材料一并清除', () => {
    saveLLMCredentials('https://api.x.com/v1', KEY);
    clearLLMCredentials();
    expect(loadLLMConfig()).toBeNull();
    expect(loadApiKey()).toBeNull();
    expect(store.size).toBe(0);
  });

  it('密文被篡改时返回 null 而不是乱码', () => {
    saveLLMCredentials('https://api.x.com/v1', KEY);
    const cfg = loadLLMConfig()!;
    store.set('weiqi.llm.config', JSON.stringify({
      ...cfg,
      encryptedApiKey: '2.!!!!notbase64!!!!.!!!!',
    }));
    expect(loadApiKey()).toBeNull();
  });

  it('每次加密使用不同 nonce，密文不重复', () => {
    const a = saveLLMCredentials('https://api.x.com/v1', KEY);
    const b = saveLLMCredentials('https://api.x.com/v1', KEY);
    expect(a.encryptedApiKey).not.toBe(b.encryptedApiKey);
    expect(loadApiKey()).toBe(KEY);
  });

  it('不硬编码密钥：密钥材料是随机生成且随 off 清除', () => {
    saveLLMCredentials('https://api.x.com/v1', KEY);
    const material = store.get('weiqi.llm.key');
    expect(material).toBeTruthy();
    expect(material).not.toContain(KEY);
    const material2 = material;
    // 再次保存不换材料，保持可解密
    saveLLMCredentials('https://api.x.com/v1', KEY);
    expect(store.get('weiqi.llm.key')).toBe(material2);
    expect(loadApiKey()).toBe(KEY);
  });
});

describe('maskApiKey', () => {
  it('只保留末 4 位', () => {
    expect(maskApiKey('sk-abcdefgh')).toBe('sk-***efgh');
    expect(maskApiKey('abc')).toBe('****');
  });
});
