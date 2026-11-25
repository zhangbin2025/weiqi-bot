/**
 * foxwq_fetch_batch 内置算子单测：查 uid → 翻页 → 二跳展开 → 去重投影 → 失败语义。
 *
 * 不触网：WebFetchToolDeps.fetchImpl 注入假 fetch（拦截透明代理 target，解出内层
 * 野狐 URL 后按 dstuid / lastcode 回 JSON）。与 WebFetchTool.test.ts 同口径。
 * 零时钟、零随机数，全部结果确定性可复算。
 */
import { describe, it, expect } from 'vitest';
import type { WebFetchToolDeps } from '@application/chat/WebFetchTool';
import { createMemoryWebFetchCache } from '@application/chat/WebFetchCache';
import { createFoxwqCirclePrimitives, FOXWQ_FETCH_BATCH_TOOL_NAME } from '../FoxwqCirclePrimitives';
import { createBasicPrimitives } from '../BasicPrimitives';
import type { PrimitiveResult } from '@application/skill/SkillTypes';

const PROXY = 'https://api.weiqi.lol';
const ROOT_UID = '100';

/** 造一局野狐原始行（uid 用数值，验算子 String(...) 字符串化）。 */
function game(chessid: string, blackuid: number, whiteuid: number, extra: Record<string, unknown> = {}) {
  return {
    chessid,
    blackuid, blacknick: `黑${blackuid}`, blackdan: 9,
    whiteuid, whitenick: `白${whiteuid}`, whitedan: 8,
    starttime: '2026-11-20 10:00:00', winner: 1, reason: '', point: 2.5,
    ...extra,
  };
}

/** 一次棋谱页响应：result:0 + 顶层 lastcode + chesslist（单局内不含 code 字段）。 */
function page(lastcode: string, chesslist: unknown[] = []) {
  return { result: 0, lastcode, chesslist };
}

interface Reply { status?: number; body: unknown }

/**
 * 假 fetch：解出透明代理 target 里的内层野狐 URL，交给 responder 决定回什么。
 * innerCalls 记录解码后的内层 URL，供断言翻页游标 / 昵称编码 / 请求顺序。
 */
function fakeFetch(responder: (url: URL) => Reply) {
  const innerCalls: URL[] = [];
  const impl = (async (target: string) => {
    const outer = new URL(target);
    expect(outer.origin).toBe(PROXY);
    const innerRaw = outer.searchParams.get('url');
    expect(innerRaw).toBeTruthy();
    const inner = new URL(innerRaw!);
    innerCalls.push(inner);
    const r = responder(inner);
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status, statusText: status === 200 ? 'OK' : 'ERR',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify(r.body),
    };
  }) as unknown as typeof fetch;
  return { impl, innerCalls };
}

/** 通用 responder：用户查询 + 按 `${dstuid}|${lastcode}` 索引的棋谱页表。 */
function server(opts: {
  user?: unknown;
  pages?: Record<string, unknown>;
}) {
  return (url: URL): Reply => {
    if (url.pathname.endsWith('QueryUserInfoPanel')) {
      return { body: opts.user ?? { result: 1 } };
    }
    if (url.pathname.endsWith('YHWQFetchChessList')) {
      const key = `${url.searchParams.get('dstuid')}|${url.searchParams.get('lastcode')}`;
      const body = opts.pages?.[key];
      return { body: body ?? { result: 1 } }; // 未配置的页 = 请求失败
    }
    return { status: 404, body: {} };
  };
}

function deps(impl: typeof fetch): WebFetchToolDeps {
  return {
    proxyUrl: PROXY,
    timeoutMs: 60_000,
    fetchImpl: impl,
    cache: createMemoryWebFetchCache(),
  };
}

/** 取算子并执行一次，返回 value（断言 ok 后）。 */
async function run(webDeps: WebFetchToolDeps, args: Record<string, unknown>): Promise<PrimitiveResult> {
  const prims = createFoxwqCirclePrimitives(webDeps);
  return prims[0]!.execute(JSON.stringify(args));
}

/** 主账号 100 的默认场景：两局对 200、一局对 300 → 对手 [200,300]。 */
const ROOT_GAMES = [
  game('g1', 100, 200),
  game('g2', 100, 200),
  game('g3', 300, 100),
];

const USER_OK = { result: 0, uid: 100, username: '柯洁', dan: 9 };

describe('foxwq_fetch_batch — 装配', () => {
  it('工厂导出算子名 snake_case，且已展开进 createBasicPrimitives', () => {
    const prims = createFoxwqCirclePrimitives(deps((async () => ({})) as unknown as typeof fetch));
    expect(prims).toHaveLength(1);
    expect(prims[0]!.name).toBe('foxwq_fetch_batch');
    expect(prims[0]!.name).toBe(FOXWQ_FETCH_BATCH_TOOL_NAME);
    const basic = createBasicPrimitives(deps((async () => ({})) as unknown as typeof fetch));
    expect(basic.some((p) => p.name === FOXWQ_FETCH_BATCH_TOOL_NAME)).toBe(true);
  });
});

describe('foxwq_fetch_batch — 正常路径', () => {
  it('默认 maxHops=2：value 字段齐全、uid 字符串化、按 chessid 去重、对手按局数降序/uid 升序', async () => {
    const ff = fakeFetch(server({
      user: USER_OK,
      pages: {
        '100|0': page('L1', ROOT_GAMES),          // pages=1，不再取 L1
        '200|0': page('', [game('g2', 100, 200), game('g4', 200, 400)]), // g2 与根页重复
        '300|0': page('', [game('g5', 300, 500)]),
      },
    }));
    const r = await run(deps(ff.impl), { nickname: '柯洁', pages: 1, opponentCount: 8, maxHops: 2 });

    expect(r.ok).toBe(true);
    const v = r.value as {
      games: Array<Record<string, unknown>>;
      rootUid: string; rootName: string; expandedUids: string[]; fetchedUids: string[];
    };
    expect(v.rootUid).toBe(ROOT_UID);
    expect(v.rootName).toBe('柯洁');
    expect(v.expandedUids).toEqual(['200', '300']); // 200 出现 2 局 > 300 的 1 局
    expect(v.fetchedUids).toEqual(['100', '200', '300']);
    // 5 局去重（g2 跨根页与 200 页重复，只保留一次）
    expect(v.games.map((g) => g['chessid'])).toEqual(['g1', 'g2', 'g3', 'g4', 'g5']);
    // 紧凑行恰好 11 个契约字段，uid 全部字符串化
    const g1 = v.games[0]!;
    expect(Object.keys(g1).sort()).toEqual([
      'blackdan', 'blacknick', 'blackuid', 'chessid', 'point', 'reason',
      'starttime', 'whitedan', 'whitenick', 'whiteuid', 'winner',
    ]);
    expect(g1['blackuid']).toBe('100');
    expect(g1['whiteuid']).toBe('200');
    // observation 只给摘要，不回灌业务正文（棋谱 id / 昵称都不出现）
    expect(r.observation).toContain('抓取 3 个 uid');
    expect(r.observation).toContain('共 5 局');
    expect(r.observation).toContain('失败 0 个');
    expect(r.observation).not.toContain('g1');
    expect(r.observation).not.toContain('柯洁');
    // 内层 URL：查 uid 一次 + 根 + 2 个对手 = 4 次，且都打到透明代理链路
    expect(ff.innerCalls).toHaveLength(4);
    expect(ff.innerCalls[0]!.searchParams.get('username')).toBe('柯洁');
  });

  it('maxHops=1：只抓主账号，expandedUids=[]、fetchedUids 只含 rootUid', async () => {
    const ff = fakeFetch(server({
      user: USER_OK,
      pages: { '100|0': page('', ROOT_GAMES) },
    }));
    const r = await run(deps(ff.impl), { nickname: '柯洁', pages: 1, opponentCount: 8, maxHops: 1 });

    expect(r.ok).toBe(true);
    const v = r.value as { games: unknown[]; expandedUids: string[]; fetchedUids: string[] };
    expect(v.games).toHaveLength(3);
    expect(v.expandedUids).toEqual([]);
    expect(v.fetchedUids).toEqual([ROOT_UID]);
    expect(ff.innerCalls).toHaveLength(2); // 查 uid + 主账号一页
  });

  it('opponentCount 只作规模约束：取前 N 个对手，不引入判定阈值', async () => {
    const ff = fakeFetch(server({
      user: USER_OK,
      pages: {
        '100|0': page('', ROOT_GAMES),
        '200|0': page('', [game('g4', 200, 400)]),
      },
    }));
    const r = await run(deps(ff.impl), { nickname: '柯洁', pages: 1, opponentCount: 1, maxHops: 2 });
    expect(r.ok).toBe(true);
    const v = r.value as { expandedUids: string[]; fetchedUids: string[] };
    expect(v.expandedUids).toEqual(['200']); // 出现局数最多的那一个
    expect(v.fetchedUids).toEqual(['100', '200']);
    expect(ff.innerCalls).toHaveLength(3);
  });

  it('pages=2：用响应顶层 lastcode 作为下一页 lastcode（单局内无 code 字段）', async () => {
    const ff = fakeFetch(server({
      user: USER_OK,
      pages: {
        '100|0': page('L1', [game('g1', 100, 200)]),
        '100|L1': page('L2', [game('g2', 100, 300)]), // pages=2，到此为止，不再取 L2
      },
    }));
    const r = await run(deps(ff.impl), {
      nickname: '柯洁', pages: 2, opponentCount: 0, maxHops: 1,
    });
    expect(r.ok).toBe(true);
    const v = r.value as { games: Array<Record<string, unknown>> };
    expect(v.games.map((g) => g['chessid'])).toEqual(['g1', 'g2']);
    const chessCalls = ff.innerCalls.filter((u) => u.pathname.endsWith('YHWQFetchChessList'));
    expect(chessCalls).toHaveLength(2);
    expect(chessCalls[0]!.searchParams.get('lastcode')).toBe('0');
    expect(chessCalls[1]!.searchParams.get('lastcode')).toBe('L1'); // 来自顶层 lastcode
    expect(chessCalls[0]!.searchParams.get('dstuid')).toBe(ROOT_UID);
  });

  it('昵称在算子内 encodeURIComponent：特殊字符安全进 query', async () => {
    const ff = fakeFetch(server({
      user: { result: 0, uid: 100, username: 'a b&c' },
      pages: { '100|0': page('', []) },
    }));
    const r = await run(deps(ff.impl), {
      nickname: 'a b&c', pages: 1, opponentCount: 0, maxHops: 1,
    });
    expect(r.ok).toBe(true);
    // 解码后的 username 仍是原样（编码发生在算子内，代理链路再编码一次不影响取值）
    expect(ff.innerCalls[0]!.searchParams.get('username')).toBe('a b&c');
    expect((r.value as { rootName: string }).rootName).toBe('a b&c');
  });
});

describe('foxwq_fetch_batch — 失败语义', () => {
  it('查 uid result!==0 → ok:false，不编造数据', async () => {
    const ff = fakeFetch(server({ user: { result: 1, errmsg: '不存在' } }));
    const r = await run(deps(ff.impl), { nickname: '查无此人', pages: 1, opponentCount: 8, maxHops: 2 });
    expect(r.ok).toBe(false);
    expect(r.value).toBeUndefined();
    expect(r.observation).toContain('查不到');
  });

  it('查 uid 成功但 uid 为空 → ok:false', async () => {
    const ff = fakeFetch(server({ user: { result: 0 } }));
    const r = await run(deps(ff.impl), { nickname: '空uid', pages: 1, opponentCount: 8, maxHops: 2 });
    expect(r.ok).toBe(false);
    expect(r.value).toBeUndefined();
  });

  it('单个对手请求失败 → 跳过该 uid（fetchedUids 不含它），其余继续，ok:true', async () => {
    const ff = fakeFetch(server({
      user: USER_OK,
      pages: {
        '100|0': page('', ROOT_GAMES),
        '200|0': { result: 1, resultstr: '失败' },   // 200 整页失败
        '300|0': page('', [game('g5', 300, 500)]),    // 300 成功
      },
    }));
    const r = await run(deps(ff.impl), { nickname: '柯洁', pages: 1, opponentCount: 8, maxHops: 2 });
    expect(r.ok).toBe(true);
    const v = r.value as { expandedUids: string[]; fetchedUids: string[]; games: unknown[] };
    expect(v.expandedUids).toEqual(['200', '300']);   // 展开仍按根局计算
    expect(v.fetchedUids).toEqual(['100', '300']);    // 失败的 200 不在其中
    expect(v.games).toHaveLength(4);                  // g1,g2,g3,g5
    expect(r.observation).toContain('失败 1 个');
  });

  it('全部失败（主账号棋谱也失败）→ ok:false + 明确 observation', async () => {
    const ff = fakeFetch(server({
      user: USER_OK,
      pages: { '100|0': { result: 1, resultstr: '取数失败' } },
    }));
    const r = await run(deps(ff.impl), { nickname: '柯洁', pages: 1, opponentCount: 8, maxHops: 2 });
    expect(r.ok).toBe(false);
    expect(r.value).toBeUndefined();
    expect(r.observation).toContain('全部');
    expect(r.observation).toContain('失败 1 个');
  });
});

describe('foxwq_fetch_batch — 参数校验（严格、不隐式兜底）', () => {
  const okDeps = () => deps(fakeFetch(server({ user: USER_OK, pages: { '100|0': page('', []) } })).impl);

  it('nickname 必填且非空', async () => {
    expect((await run(okDeps(), { pages: 1 })).ok).toBe(false);
    expect((await run(okDeps(), { nickname: '   ' })).ok).toBe(false);
  });
  it('pages 必须是 ≥1 的整数', async () => {
    expect((await run(okDeps(), { nickname: 'x', pages: 0 })).ok).toBe(false);
    expect((await run(okDeps(), { nickname: 'x', pages: 1.5 })).ok).toBe(false);
  });
  it('opponentCount 必须是 ≥0 的整数', async () => {
    expect((await run(okDeps(), { nickname: 'x', opponentCount: -1 })).ok).toBe(false);
  });
  it('maxHops 只能是 1 或 2', async () => {
    expect((await run(okDeps(), { nickname: 'x', maxHops: 3 })).ok).toBe(false);
    expect((await run(okDeps(), { nickname: 'x', maxHops: 1 })).ok).toBe(true);
  });
  it('非 JSON / 非对象参数结构化失败', async () => {
    const prims = createFoxwqCirclePrimitives(okDeps());
    expect((await prims[0]!.execute('not json')).ok).toBe(false);
    expect((await prims[0]!.execute('[]')).ok).toBe(false);
  });
});
