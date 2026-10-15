/**
 * 跨域直连白名单单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  isCorsVerifiedDirectHost,
  CORS_VERIFIED_DIRECT_HOSTS,
} from '../PlatformConstants';

describe('isCorsVerifiedDirectHost', () => {
  it('已验证站点返回 true', () => {
    expect(isCorsVerifiedDirectHost('https://online-go.com/api/v1/puzzles/')).toBe(true);
  });

  it('子域名一并放行', () => {
    expect(isCorsVerifiedDirectHost('https://api.online-go.com/x')).toBe(true);
  });

  it('未列入白名单的站点返回 false', () => {
    expect(isCorsVerifiedDirectHost('https://www.101weiqi.com/')).toBe(false);
    expect(isCorsVerifiedDirectHost('https://newframe.foxwq.com/cgi')).toBe(false);
  });

  it('主机名精确匹配，防止 evil-online-go.com 这类绕过', () => {
    expect(isCorsVerifiedDirectHost('https://evil-online-go.com/')).toBe(false);
    expect(isCorsVerifiedDirectHost('https://online-go.com.evil.com/')).toBe(false);
  });

  it('大小写不敏感', () => {
    expect(isCorsVerifiedDirectHost('https://ONLINE-GO.COM/api/v1/')).toBe(true);
  });

  it('空值 / 相对路径返回 false（保守走代理）', () => {
    expect(isCorsVerifiedDirectHost(undefined)).toBe(false);
    expect(isCorsVerifiedDirectHost('')).toBe(false);
    expect(isCorsVerifiedDirectHost('/api/v1/puzzles/')).toBe(false);
  });

  it('白名单中每个条目都能被自身 URL 匹配（防止写错域名）', () => {
    for (const host of CORS_VERIFIED_DIRECT_HOSTS) {
      expect(isCorsVerifiedDirectHost(`https://${host}/x`)).toBe(true);
    }
  });
});
