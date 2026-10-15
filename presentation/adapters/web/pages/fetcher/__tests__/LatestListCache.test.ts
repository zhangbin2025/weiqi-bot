/**
 * 最新列表快照缓存测试
 * @description 覆盖：命中/未命中、关键字不符、过期、体积超限、内置库不缓存、
 *              只保留当前来源、TTL 差异。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LatestListCache } from '../LatestListCache';
import { SessionStorageAdapter } from '../../../../../../infrastructure/storage/adapters/web/SessionStorageAdapter';

const KEY_PREFIX = 'weiqi-bot:fetcher_latest_snapshot_';

const item = (url: string, source = 'ogs-puzzle') => ({ source, title: url, date: '2026-10-15', url });

function makeCache() {
  return new LatestListCache(new SessionStorageAdapter('weiqi-bot'));
}

describe('LatestListCache', () => {
  beforeEach(() => { sessionStorage.clear(); });

  it('写入后按同一来源+关键字可原样取回', async () => {
    const c = makeCache();
    const items = [item('https://x/1'), item('https://x/2')];
    await c.save('ogs-puzzle', '', items);
    const got = await c.load('ogs-puzzle', '');
    expect(got).toEqual(items);
  });

  it('关键字不符则不命中（换了查询条件就该重查）', async () => {
    const c = makeCache();
    await c.save('ogs-puzzle', '5k', [item('https://x/1')]);
    expect(await c.load('ogs-puzzle', '')).toBeNull();
    expect(await c.load('ogs-puzzle', '5k')).toHaveLength(1);
  });

  it('来源不符则不命中', async () => {
    const c = makeCache();
    await c.save('ogs-puzzle', '', [item('https://x/1')]);
    expect(await c.load('goproblems', '')).toBeNull();
  });

  it('空列表不写入（避免把"查无结果"固化下来）', async () => {
    const c = makeCache();
    await c.save('ogs-puzzle', '', []);
    expect(await c.load('ogs-puzzle', '')).toBeNull();
  });

  it('内置棋谱库不缓存（4万条会撑爆 sessionStorage）', async () => {
    const c = makeCache();
    await c.save('lib-life-death', '', [item('lib://life-and-death/2026-10-12/0', 'lib-life-death')]);
    expect(await c.load('lib-life-death', '')).toBeNull();
    expect(sessionStorage.getItem(KEY_PREFIX + 'lib-life-death')).toBeNull();
  });

  it('只保留当前来源的快照，写入其它来源时清理旧的', async () => {
    const c = makeCache();
    await c.save('ogs-puzzle', '', [item('https://x/1')]);
    await c.save('weiqi101', '', [item('https://y/1', 'weiqi101')]);
    expect(await c.load('ogs-puzzle', '')).toBeNull();
    expect(await c.load('weiqi101', '')).toHaveLength(1);
  });

  it('体积超限则放弃缓存，返回时走重查', async () => {
    const c = makeCache();
    // 每条 ~700 字节，2000 条约 1.4MB，必然超 1MB 上限
    const big = Array.from({ length: 2000 }, (_, i) => ({
      source: 'ogs-puzzle',
      title: 'x'.repeat(600),
      subtitle: 'y'.repeat(60),
      date: '2026-10-15',
      url: 'https://online-go.com/puzzle/' + i,
    }));
    await c.save('ogs-puzzle', '', big);
    expect(await c.load('ogs-puzzle', '')).toBeNull();
  });

  it('超过 TTL 视为过期（直播来源 TTL 更短）', async () => {
    const c = makeCache();
    await c.save('ogs-live', '', [item('https://x/1', 'ogs-live')]);
    // 手动把 savedAt 往前拨 3 分钟（> 直播 2 分钟 TTL，< 常规 30 分钟）
    const raw = JSON.parse(sessionStorage.getItem(KEY_PREFIX + 'ogs-live')!);
    raw.savedAt = Date.now() - 3 * 60 * 1000;
    sessionStorage.setItem(KEY_PREFIX + 'ogs-live', JSON.stringify(raw));
    expect(await c.load('ogs-live', '')).toBeNull();

    // 同样的 3 分钟对常规来源仍在有效期内
    await c.save('ogs-puzzle', '', [item('https://x/1')]);
    const raw2 = JSON.parse(sessionStorage.getItem(KEY_PREFIX + 'ogs-puzzle')!);
    raw2.savedAt = Date.now() - 3 * 60 * 1000;
    sessionStorage.setItem(KEY_PREFIX + 'ogs-puzzle', JSON.stringify(raw2));
    expect(await c.load('ogs-puzzle', '')).toHaveLength(1);
  });

  it('clear / clearAll 能清掉快照', async () => {
    const c = makeCache();
    await c.save('ogs-puzzle', '', [item('https://x/1')]);
    await c.save('goproblems', '', [item('https://z/1', 'goproblems')]);
    await c.clear('ogs-puzzle');
    expect(await c.load('ogs-puzzle', '')).toBeNull();
    expect(await c.load('goproblems', '')).toHaveLength(1);
    await c.clearAll();
    expect(await c.load('goproblems', '')).toBeNull();
  });
});
