/** @vitest-environment jsdom */
/**
 * 自选链接契约：只放合法代码，宿主不碰存储。
 * 纯函数测试不需要真 DOM，但放在 pages/ 下沿用该目录的 jsdom 环境。
 */
import { describe, it, expect } from 'vitest';
import {
  PREF_ADD_WATCH_SCHEME, parseWatchAddCode, watchAddUserMessage,
} from '../PrefLink';

describe('parseWatchAddCode', () => {
  it('接受各市场合法代码', () => {
    for (const code of ['sh600519', 'sz300750', 'hk00700', 'usAAPL', 'usBRK.B']) {
      expect(parseWatchAddCode(`${PREF_ADD_WATCH_SCHEME}${code}`)).toBe(code);
    }
  });

  it('拒绝非本 scheme / 空 / 注入形状', () => {
    expect(parseWatchAddCode(null)).toBeNull();
    expect(parseWatchAddCode(undefined)).toBeNull();
    expect(parseWatchAddCode('https://evil.example/?code=sh600519')).toBeNull();
    expect(parseWatchAddCode('event-table:abc')).toBeNull();
    for (const bad of [
      '', 'sh60051', 'sh6005190', 'hk0700', 'sz3007500',
      'sz300750/../../secrets/github_token',
      'usAAPL&x=1', 'sh600519,sz300750', 'java\nscript:alert(1)',
      'SH600519', 'sh600519 ', '600519',
    ]) {
      expect(parseWatchAddCode(`${PREF_ADD_WATCH_SCHEME}${bad}`)).toBeNull();
    }
  });
});

describe('watchAddUserMessage', () => {
  it('只描述意图 + 代码，不携带价格 / 值 / 写入内容', () => {
    const text = watchAddUserMessage('sh600519');
    expect(text).toContain('sh600519');
    expect(text).toContain('加入我的自选');
    expect(text).not.toContain('1442');
    expect(text).toContain('保存到本地偏好');
  });
});
