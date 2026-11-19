import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  normalizeProxyUrl,
  loadWebProxyOverride,
  saveWebProxyOverride,
  clearWebProxyOverride,
} from '../WebProxyOverride';

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

describe('normalizeProxyUrl', () => {
  it('http/https 合法，去掉尾斜杠', () => {
    expect(normalizeProxyUrl('https://api.weiqi.lol')).toBe('https://api.weiqi.lol');
    expect(normalizeProxyUrl('  https://api.weiqi.lol/  ')).toBe('https://api.weiqi.lol');
    expect(normalizeProxyUrl('http://localhost:8080/proxy///')).toBe('http://localhost:8080/proxy');
  });

  it('保留 URL 路径/主机大小写（不能被小写化）', () => {
    expect(normalizeProxyUrl('https://API.Example.COM/V1/Proxy')).toBe('https://API.Example.COM/V1/Proxy');
  });

  it('拒绝非 http(s) 与非法地址', () => {
    expect(() => normalizeProxyUrl('ftp://x.com')).toThrow();
    expect(() => normalizeProxyUrl('api.weiqi.lol')).toThrow();
    expect(() => normalizeProxyUrl('')).toThrow();
  });

  it('拒绝 userinfo / query / fragment（避免凭据明文与拼接冲突）', () => {
    expect(() => normalizeProxyUrl('https://user:pw@x.com')).toThrow();
    expect(() => normalizeProxyUrl('https://x.com/?token=abc')).toThrow();
    expect(() => normalizeProxyUrl('https://x.com/#frag')).toThrow();
  });
});

describe('WebProxyOverride store', () => {
  beforeEach(() => installMemoryLocalStorage());
  afterEach(() => vi.unstubAllGlobals());

  it('未设置时返回 null', () => {
    expect(loadWebProxyOverride()).toBeNull();
  });

  it('save 后 load 读到归一化值，clear 后回落 null', () => {
    expect(saveWebProxyOverride('https://my.proxy.dev/')).toBe('https://my.proxy.dev');
    expect(loadWebProxyOverride()).toBe('https://my.proxy.dev');
    clearWebProxyOverride();
    expect(loadWebProxyOverride()).toBeNull();
  });

  it('损坏的值当作未设置', () => {
    localStorage.setItem('weiqi.web.proxy.override', 'not-a-url');
    expect(loadWebProxyOverride()).toBeNull();
  });
});
