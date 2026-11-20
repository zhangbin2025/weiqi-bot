/** @vitest-environment jsdom */
/**
 * 通用 prefs-add: 链接契约：任何 skill 存偏好都用同一条链路，宿主不认识业务键名。
 * 纯函数测试不需要真 DOM，但放在 pages/ 下沿用该目录的 jsdom 环境。
 */
import { describe, it, expect } from 'vitest';
import {
  PREF_ADD_SCHEME,
  parsePrefAddHref, prefAddUserMessage, buildPrefAddHref,
} from '../PrefLink';

describe('parsePrefAddHref —— 通用 scheme', () => {
  it('天气 / 股票 / 任意新技能都能解析，宿主不写死键名', () => {
    const cases = [
      // value 用 DOM 里的形态：中文经 marked 编码，ASCII 原样
      ['prefs', 'weather.watchlist', '%E5%8C%97%E4%BA%AC', '北京'],
      ['prefs', 'stock.watchlist', 'sh600519', 'sh600519'],
      ['prefs', 'my.new.skill.favorites', '%E5%B7%B4%E9%BB%8E', '巴黎'],
      ['checkpoints', 'session.marker', 'abc-123', 'abc-123'],
    ] as const;
    for (const [domain, key, raw, value] of cases) {
      expect(parsePrefAddHref(`${PREF_ADD_SCHEME}${domain}:${key}:${raw}`))
        .toEqual({ domain, key, value });
    }
    // buildPrefAddHref 产出的是配方里的明文形态，模型写出来后由 marked 编码；
    // 这里只锁它拼出的字符串，不直接喂给解析器（真实 DOM 不会是裸中文）。
    expect(buildPrefAddHref('prefs', 'weather.watchlist', '北京'))
      .toBe(`${PREF_ADD_SCHEME}prefs:weather.watchlist:北京`);
  });

  it('ASCII 明文标识与编码态标识都能解析（含逗号 / 点 / 横线）', () => {
    for (const v of ['Shanghai', 'usBRK.B', 'abc-123', '%E5%B7%B4%E9%BB%8E-%E9%87%8C%E6%98%82']) {
      expect(parsePrefAddHref(`${PREF_ADD_SCHEME}prefs:weather.watchlist:${v}`)).not.toBeNull();
    }
  });

  it('裸中文（未经 marked 编码）不是 DOM 真实形态，拒绝而不误解析', () => {
    expect(parsePrefAddHref(`${PREF_ADD_SCHEME}prefs:weather.watchlist:北京`)).toBeNull();
  });

  it('拒绝非本 scheme / 段数不对 / 空值', () => {
    expect(parsePrefAddHref(null)).toBeNull();
    expect(parsePrefAddHref(undefined)).toBeNull();
    expect(parsePrefAddHref('https://evil.example/prefs-add:prefs:k:北京')).toBeNull();
    expect(parsePrefAddHref('other-scheme:abc')).toBeNull();
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

describe('回归 2026-11-19：marked 会把中文 percent 编码，点击不能失灵', () => {
  // 实测：marked.parse('[x](...:北京)') 得到 href="...:%E5%8C%97%E4%BA%AC"
  it('解码中文城市名，回灌消息里是明文中文', () => {
    for (const [encoded, plain] of [
      ['%E5%8C%97%E4%BA%AC', '北京'],
      ['%E4%B8%8A%E6%B5%B7', '上海'],
      ['%E5%B7%B4%E9%BB%8E', '巴黎'],
      ['%E5%B9%BF%E5%B7%9E-%E6%B7%B1%E5%9C%B3', '广州-深圳'],
    ] as const) {
      const href = `${PREF_ADD_SCHEME}prefs:weather.watchlist:${encoded}`;
      expect(parsePrefAddHref(href)).toEqual({
        domain: 'prefs', key: 'weather.watchlist', value: plain,
      });
      expect(prefAddUserMessage(parsePrefAddHref(href)!)).toContain(plain);
    }
  });

  it('纯 ASCII 明文仍照常可用（股票代码路径不受影响）', () => {
    expect(parsePrefAddHref('prefs-add:prefs:stock.watchlist:sh600519')?.value).toBe('sh600519');
    expect(parsePrefAddHref('prefs-add:prefs:stock.watchlist:usBRK.B')?.value).toBe('usBRK.B');
  });

  it('percent 编码不能绕过黑名单：解码后含危险字符一律拒绝', () => {
    for (const bad of [
      '%3Cscript%3E',        // <script>
      'v%3Aw',               // 解码出冒号
      'v%0Ainjected',        // 解码出换行
      'v%22onmouseover%3D1', // 解码出引号
      'v%23frag',            // 解码出 #
      'v%3Fx%3D1',           // 解码出 ?
      'https%3A%2F%2Fevil.example',
    ]) {
      expect(parsePrefAddHref(`${PREF_ADD_SCHEME}prefs:k:${bad}`)).toBeNull();
    }
  });

  it('非法百分号序列（半截 / 非法 UTF-8）拒绝而不抛异常', () => {
    for (const bad of ['%', '%ZZ', '%E5%8C', '%FF%FE', 'v%']) {
      expect(() => parsePrefAddHref(`${PREF_ADD_SCHEME}prefs:k:${bad}`)).not.toThrow();
      expect(parsePrefAddHref(`${PREF_ADD_SCHEME}prefs:k:${bad}`)).toBeNull();
    }
  });
});
