/**
 * 桌面端代理放行判定单测
 */
import { describe, it, expect } from 'vitest';
import { shouldBypassProxy, isLocalServerRequest } from '../proxy-bypass';

describe('shouldBypassProxy', () => {
  it('OpenAI 兼容 chat/completions 端点直连放行', () => {
    expect(shouldBypassProxy('https://api.x.com/v1/chat/completions')).toBe(true);
    expect(shouldBypassProxy('https://api.x.com/chat/completions')).toBe(true);
    expect(shouldBypassProxy('https://api.lkeap.cloud.tencent.com/coding/v3/chat/completions')).toBe(true);
    expect(shouldBypassProxy('https://api.x.com/v1/chat/completions/')).toBe(true);
    expect(shouldBypassProxy('https://api.x.com/v1/chat/completions?foo=1')).toBe(true); // query 忽略
  });

  it('本地资产服务器请求放行', () => {
    expect(shouldBypassProxy('http://127.0.0.1:8765/assistant/index.html')).toBe(true);
    expect(shouldBypassProxy('http://localhost:8765/proxy/?url=https%3A%2F%2Fapi.x.com')).toBe(true);
  });

  it('业务 API（棋谱/野狐/CDN 等）继续走代理', () => {
    expect(shouldBypassProxy('https://api.weiqi.lol/games/123')).toBe(false);
    expect(shouldBypassProxy('https://newframe.foxwq.com/api/foo')).toBe(false);
    expect(shouldBypassProxy('https://cdn.example.com/model.bin')).toBe(false);
  });

  it('路径里带 chat/completions 但不是端点的不放行（避免误伤）', () => {
    expect(shouldBypassProxy('https://api.x.com/v1/chat/completions/list')).toBe(false);
    expect(shouldBypassProxy('https://api.x.com/docs/chat-completions')).toBe(false);
  });

  it('非法 URL 不放行、不抛错', () => {
    expect(shouldBypassProxy('not a url')).toBe(false);
    expect(shouldBypassProxy('')).toBe(false);
  });
});

describe('isLocalServerRequest', () => {
  it('识别本地地址', () => {
    expect(isLocalServerRequest('http://127.0.0.1:8765/x')).toBe(true);
    expect(isLocalServerRequest('http://localhost:8765/x')).toBe(true);
    expect(isLocalServerRequest('https://api.x.com/x')).toBe(false);
  });
});
