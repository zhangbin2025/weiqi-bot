/** @vitest-environment jsdom */
/**
 * 通用 prefs-add: 链接契约：任何 skill 存偏好都用同一条链路，宿主不认识业务键名。
 * 纯函数测试不需要真 DOM，但放在 pages/ 下沿用该目录的 jsdom 环境。
 */
import { describe, it, expect } from 'vitest';
import {
  PREF_ADD_SCHEME, PREF_ADD_WATCH_SCHEME,
  parsePrefAddHref, prefAddUserMessage, buildPrefAddHref,
  parseWatchAddCode, watchAddUserMessage,
} from '../PrefLink';

describe('parsePrefAddHref —— 通用 scheme', () => {
  it('天气 / 股票 / 任意新技能都能解析，宿主不写死键名', () => {
    const cases = [
      ['prefs', 'weather.watchlist', '北京'],
      ['prefs', 'stock.watchlist', 'sh600519'],
      ['prefs', 'my.new.skill.favorites', '巴黎'],
      ['checkpoints', 'session.marker', 'abc-123'],
    ] as const;
    for (const [domain, key, value] of cases) {
      expect(parsePrefAddHref(buildPrefAddHref(domain, key, value)))
        .toEqual({ domain, key, value });
    }
  });

  it('中文城市名、拼音、带点/横线的标识都按明文原样保留（无需 percent 编码）', () => {
    for (const v of ['北京', 'Shanghai', '申真谞', 'usBRK.B', '巴黎-里昂', 'a,b']) {
      expect(parsePrefAddHref(`${PREF_ADD_SCHEME}prefs:weather.watchlist:${v}`)?.value).toBe(v);
    }
  });

  it('拒绝非本 scheme / 段数不对 / 空值', () => {
    expect(parsePrefAddHref(null)).toBeNull();
    expect(parsePrefAddHref(undefined)).toBeNull();
    expect(parsePrefAddHref('https://evil.example/prefs-add:prefs:k:北京')).toBeNull();
    expect(parsePrefAddHref('event-table:abc')).toBeNull();
    expect(parsePrefAddHref(`${PREF_ADD_WATCH_SCHEME}sh600519`)).toBeNull();
    for (const bad of [
      `${PREF_ADD_SCHEME}`, `${PREF_ADD_SCHEME}prefs`,
      `${PREF_ADD_SCHEME}prefs:k`, `${PREF_ADD_SCHEME}prefs:k:`,
      `${PREF_ADD_SCHEME}:k:v`, `${PREF_ADD_SCHEME}prefs::v`,
    ]) {
      expect(parsePrefAddHref(bad)).toBeNull();
    }
  });

  it('domain / key 复用宿主既有形状，非法一律拒绝', () => {
    for (const bad of [
      `${PREF_ADD_SCHEME}Prefs:k:v`,       // 域名须小写
      `${PREF_ADD_SCHEME}prefs-x:k:v`,     // 域名不含 -
      `${PREF_ADD_SCHEME}1prefs:k:v`,
      `${PREF_ADD_SCHEME}prefs:k/../x:v`,  // key 含 /
      `${PREF_ADD_SCHEME}prefs:k x:v`,     // key 含空格
      `${PREF_ADD_SCHEME}prefs:${'k'.repeat(129)}:v`,
    ]) {
      expect(parsePrefAddHref(bad)).toBeNull();
    }
  });

  it('拒绝注入形状：markdown 定界 / HTML / URL / 换行 / 整段 JSON / 超长', () => {
    for (const bad of [
      `${PREF_ADD_SCHEME}prefs:k:v:w`,           // 值里再有冒号
      `${PREF_ADD_SCHEME}prefs:k:v(x)`,
      `${PREF_ADD_SCHEME}prefs:k:v[x]`,
      `${PREF_ADD_SCHEME}prefs:k:<script>`,
      `${PREF_ADD_SCHEME}prefs:k:v"onmouseover=1`,
      `${PREF_ADD_SCHEME}prefs:k:v#frag`,
      `${PREF_ADD_SCHEME}prefs:k:v?x=1`,
      `${PREF_ADD_SCHEME}prefs:k:v%3A`,
      `${PREF_ADD_SCHEME}prefs:k:https://evil.example`,
      `${PREF_ADD_SCHEME}prefs:k:v\ninjected`,
      `${PREF_ADD_SCHEME}prefs:k:${'v'.repeat(257)}`,
      `${PREF_ADD_SCHEME}prefs:k:${'v'.repeat(3000)}`,
    ]) {
      expect(parsePrefAddHref(bad)).toBeNull();
    }
  });
});

describe('prefAddUserMessage', () => {
  it('回灌只带意图 + domain/key/值，不夹带业务数据或写入内容', () => {
    const t = { domain: 'prefs', key: 'weather.watchlist', value: '北京' };
    const text = prefAddUserMessage(t);
    expect(text).toContain('北京');
    expect(text).toContain('weather.watchlist');
    expect(text).toContain("domain='prefs'");
    expect(text).toContain('保存到本地偏好');
    expect(text).not.toContain('26℃');
  });
});

describe('旧 stock-watch-add: 兼容路径', () => {
  it('合法代码仍解析、回灌文案保持原样', () => {
    for (const code of ['sh600519', 'sz300750', 'hk00700', 'usAAPL', 'usBRK.B']) {
      expect(parseWatchAddCode(`${PREF_ADD_WATCH_SCHEME}${code}`)).toBe(code);
    }
    const text = watchAddUserMessage('sh600519');
    expect(text).toContain('sh600519');
    expect(text).toContain('加入我的自选');
    expect(text).toContain('保存到本地偏好');
  });

  it('脏 href 仍静默拒绝', () => {
    for (const bad of [
      '', 'sh60051', 'sz300750/../../secrets/github_token',
      'usAAPL&x=1', 'java\nscript:alert(1)', '600519',
    ]) {
      expect(parseWatchAddCode(`${PREF_ADD_WATCH_SCHEME}${bad}`)).toBeNull();
    }
    expect(parseWatchAddCode(null)).toBeNull();
  });
});
