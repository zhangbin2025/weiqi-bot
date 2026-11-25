/**
 * 宿主内置算子 `foxwq_fetch_batch`：按昵称批量取野狐棋谱（两跳对手展开）。
 * @module application/skill/primitives/FoxwqCirclePrimitives
 *
 * 「弈友圈」技能的取数节点：DSL 保持静态 DAG，动态翻页 / 二跳展开 / 合并去重
 * 全部封装在算子内部（runner 不做循环）。网络一律复用 executeWebFetch 的
 * storeOnly:true 分支——同一透明代理链路、同一 URL 校验 / 缓存 / JSON.parse，
 * 本文件不新造 fetch、不写时钟、不写随机数、不写超时 / 重试次数
 * （沿用 webDeps.timeoutMs 与 executeWebFetch 既有行为）。
 *
 * 野狐端点与字段口径照抄 services/game/providers/foxwq/：
 * - 查 uid：https://newframe.foxwq.com/cgi/QueryUserInfoPanel?srcuid=0&username=<encodeURIComponent(昵称)>
 *   → {result:0, uid, username, ...}
 * - 棋谱列表：https://h5.foxwq.com/yehuDiamond/chessbook_local/YHWQFetchChessList
 *   ?srcuid=0&dstuid=<uid>&type=1&lastcode=<lastcode>&searchkey=&uin=<uid>
 *   → {result:0, lastcode, chesslist:[...]}
 *   翻页用响应**顶层** lastcode（单局内无 code 字段）；result!==0 视为失败。
 *
 * 数值纪律：pages / opponentCount / maxHops 只作「一次取数的业务约束」
 * （控制请求量与上下文体积，出处写进 weiqi-assets 侧 README），不是判定阈值；
 * uid 一律 String(...) 与下游 circle.normalize 的相等比较口径一致（都用字符串）。
 *
 * 失败语义：单个 uid 请求失败 → 跳过该 uid、fetchedUids 不含它，其余继续；
 * 全部失败 / 查 uid 失败 → ok:false + 明确 observation。不静默吞、不编造数据。
 * observation 只给摘要（抓了几个 uid / 共几局 / 失败几个），不回灌业务正文。
 */

import {
  executeWebFetch, type WebFetchToolDeps,
} from '@application/chat/WebFetchTool';
import type { ModelToolDefinition } from '@application/model/IModelGateway';
import type { SkillPrimitive, PrimitiveResult } from '@application/skill/SkillTypes';

export const FOXWQ_FETCH_BATCH_TOOL_NAME = 'foxwq_fetch_batch';

const FOXWQ_USER_API = 'https://newframe.foxwq.com/cgi/QueryUserInfoPanel';
const FOXWQ_CHESS_LIST_API = 'https://h5.foxwq.com/yehuDiamond/chessbook_local/YHWQFetchChessList';

/** 规模参数缺省：只作一次取数的业务约束，不是阈值（配方 inputs 会显式给默认值）。 */
const DEFAULT_PAGES = 1;
const DEFAULT_OPPONENT_COUNT = 8;
const DEFAULT_MAX_HOPS = 2;

export const FOXWQ_FETCH_BATCH_TOOL: ModelToolDefinition = {
  name: FOXWQ_FETCH_BATCH_TOOL_NAME,
  description:
    '按野狐昵称批量取棋谱（两跳对手展开，动态翻页封装在算子内，DSL 保持静态 DAG）。'
    + '先由昵称查 uid（算子内部用 encodeURIComponent 编码），再抓主账号 pages 页；'
    + '从已抓到的局里按出现局数降序、uid 升序取前 opponentCount 个对手，'
    + 'maxHops=2 时对每个对手再抓 pages 页；所有局按 chessid 去重后投影为紧凑行。'
    + 'uid 一律字符串化。结果作为纯 value 出参（games / rootUid / rootName / '
    + 'expandedUids / fetchedUids），正文不进模型上下文；'
    + '单个 uid 失败跳过该 uid、其余继续，全部失败或查 uid 失败返回 ok:false，不编造数据。'
    + 'pages / opponentCount / maxHops 只是一次取数的业务约束，不是判定阈值。',
  parameters: {
    type: 'object',
    properties: {
      nickname: {
        type: 'string',
        description: '野狐昵称（必填）；算子内部用 encodeURIComponent 编码后查 uid，配方占位符只做纯 String 替换。',
      },
      pages: {
        type: 'integer',
        description: '每个账号取几页（一页 100 局）；由配方 inputs 给默认值 1，只控制一次取数的规模。',
      },
      opponentCount: {
        type: 'integer',
        description: '二跳对手数上限；由配方 inputs 给默认值 8，只控制一次取数的规模。',
      },
      maxHops: {
        type: 'integer',
        enum: [1, 2],
        description: '1=只抓主账号；2=主账号 + 对手各抓（即「对手的交战对手」）；默认 2。',
      },
    },
    required: ['nickname'],
    additionalProperties: false,
  },
};

/** 单局紧凑投影（字段名/大小写由契约固定，B 侧 circle.normalize 按此读）。 */
interface FoxwqGameRow {
  chessid: string;
  blackuid: string;
  blacknick: string;
  blackdan: unknown;
  whiteuid: string;
  whitenick: string;
  whitedan: unknown;
  starttime: string;
  winner: unknown;
  reason: unknown;
  point: unknown;
}

/** 算子 value 出参（B 侧按 games / rootUid 读取，字段名逐字对齐契约 A）。 */
interface FoxwqBatchValue {
  games: FoxwqGameRow[];
  rootUid: string;
  rootName: string;
  expandedUids: string[];
  fetchedUids: string[];
}

interface ParsedArgs {
  nickname: string;
  pages: number;
  opponentCount: number;
  maxHops: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 严格参数解析；规模参数只作业务约束，不做任何「≥N 算熟人」式判定。 */
function parseArgs(argsJson: string): { ok: true; value: ParsedArgs } | { ok: false; error: string } {
  let raw: unknown;
  try { raw = JSON.parse(argsJson) as unknown; } catch {
    return { ok: false, error: '参数不是合法 JSON' };
  }
  if (!isRecord(raw)) return { ok: false, error: '参数必须是 JSON 对象' };
  const nickname = raw['nickname'];
  if (typeof nickname !== 'string' || nickname.trim().length === 0) {
    return { ok: false, error: 'nickname 必须是非空字符串' };
  }
  let pages = DEFAULT_PAGES;
  if (raw['pages'] !== undefined) {
    const p = raw['pages'];
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 1) {
      return { ok: false, error: 'pages 必须是 ≥1 的整数' };
    }
    pages = p;
  }
  let opponentCount = DEFAULT_OPPONENT_COUNT;
  if (raw['opponentCount'] !== undefined) {
    const c = raw['opponentCount'];
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0) {
      return { ok: false, error: 'opponentCount 必须是 ≥0 的整数' };
    }
    opponentCount = c;
  }
  let maxHops = DEFAULT_MAX_HOPS;
  if (raw['maxHops'] !== undefined) {
    const h = raw['maxHops'];
    if (h !== 1 && h !== 2) {
      return { ok: false, error: 'maxHops 只能是 1 或 2' };
    }
    maxHops = h;
  }
  return {
    ok: true,
    value: { nickname: nickname.trim(), pages, opponentCount, maxHops },
  };
}

function fail(reason: string): PrimitiveResult {
  return {
    observation: `foxwq_fetch_batch：${reason}。本次没有产出业务数据，请如实告诉用户，不要编造。`,
    ok: false,
    detail: reason,
  };
}

/**
 * 通过既有 executeWebFetch(storeOnly) 取一份 JSON：链路 / URL 校验 / 缓存全复用。
 * 返回解析后的 value；ok:false 或非对象一律视为该次请求失败，由调用方跳过。
 */
async function fetchJson(
  url: string, webDeps: WebFetchToolDeps,
): Promise<Record<string, unknown> | undefined> {
  const r = await executeWebFetch(
    JSON.stringify({ url, storeOnly: true }), webDeps,
  );
  if (!r.ok) return undefined;
  return isRecord(r.value) ? r.value : undefined;
}

/** 查昵称 → {uid, username}；result!==0 / 无 uid / 非对象一律失败（不编造）。 */
async function queryUid(
  nickname: string, webDeps: WebFetchToolDeps,
): Promise<{ uid: string; name: string } | undefined> {
  const url = `${FOXWQ_USER_API}?srcuid=0&username=${encodeURIComponent(nickname)}`;
  const data = await fetchJson(url, webDeps);
  if (data === undefined || data['result'] !== 0) return undefined;
  // 与 FoxwqUserProvider.queryUserByName 同口径：uid 为 0 / 空视为没查到；
  // 昵称回退顺序也照抄该 provider（username → name → englishname → 请求里的昵称）。
  const uid = String(data['uid'] || '').trim();
  if (!uid) return undefined;
  const rawName = data['username'] || data['name'] || data['englishname'];
  const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : nickname;
  return { uid, name };
}

/** 单局行投影：只取契约固定的 11 个字段，uid 一律 String(...)。 */
function projectGame(raw: Record<string, unknown>): FoxwqGameRow | undefined {
  const chessid = String(raw['chessid'] ?? '').trim();
  if (!chessid) return undefined;
  return {
    chessid,
    blackuid: String(raw['blackuid'] ?? ''),
    blacknick: String(raw['blacknick'] ?? ''),
    blackdan: raw['blackdan'],
    whiteuid: String(raw['whiteuid'] ?? ''),
    whitenick: String(raw['whitenick'] ?? ''),
    whitedan: raw['whitedan'],
    starttime: String(raw['starttime'] ?? ''),
    winner: raw['winner'],
    reason: raw['reason'],
    point: raw['point'],
  };
}

/**
 * 抓一个 uid 的 chesslist，共 pages 页（顶层 lastcode 翻页）。
 * result!==0 / 非对象 / 抛错都视为该 uid 失败：返回 undefined，由调用方计入失败数。
 * 成功时返回该 uid 投影后的行（未做全局去重，合并阶段统一按 chessid 去重）。
 */
async function fetchUidGames(
  uid: string, pages: number, webDeps: WebFetchToolDeps,
): Promise<FoxwqGameRow[] | undefined> {
  const rows: FoxwqGameRow[] = [];
  let lastcode = '0';
  for (let i = 0; i < pages; i += 1) {
    const url = `${FOXWQ_CHESS_LIST_API}?srcuid=0&dstuid=${encodeURIComponent(uid)}`
      + `&type=1&lastcode=${encodeURIComponent(lastcode)}&searchkey=&uin=${encodeURIComponent(uid)}`;
    let data: Record<string, unknown> | undefined;
    try {
      data = await fetchJson(url, webDeps);
    } catch {
      return undefined;
    }
    if (data === undefined || data['result'] !== 0 || !Array.isArray(data['chesslist'])) {
      return undefined;
    }
    for (const item of data['chesslist'] as unknown[]) {
      if (isRecord(item)) {
        const row = projectGame(item);
        if (row !== undefined) rows.push(row);
      }
    }
    lastcode = String(data['lastcode'] ?? '');
    if (!lastcode) break; // 没有下一页游标：按既有事实停，不引入重试 / 阈值
  }
  return rows;
}

/**
 * 从已抓到的局里提取对手 uid（对手 = 该局与 rootUid 不同的一方），
 * 按出现局数降序、uid 升序去重，取前 opponentCount 个。
 */
function pickOpponents(
  games: readonly FoxwqGameRow[], rootUid: string, opponentCount: number,
): string[] {
  const counts = new Map<string, number>();
  for (const g of games) {
    const other = g.blackuid === rootUid ? g.whiteuid
      : (g.whiteuid === rootUid ? g.blackuid : '');
    if (!other || other === rootUid) continue;
    counts.set(other, (counts.get(other) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, opponentCount)
    .map(([uid]) => uid);
}

export function createFoxwqCirclePrimitives(webDeps: WebFetchToolDeps): SkillPrimitive[] {
  return [{
    name: FOXWQ_FETCH_BATCH_TOOL_NAME,
    definition: FOXWQ_FETCH_BATCH_TOOL,
    execute: async (argsJson: string): Promise<PrimitiveResult> => {
      const parsed = parseArgs(argsJson);
      if (!parsed.ok) return fail(parsed.error);
      const { nickname, pages, opponentCount, maxHops } = parsed.value;

      // 1. 查昵称 → rootUid / rootName；查不到或 result!==0 → ok:false，不编造。
      let root: { uid: string; name: string } | undefined;
      try {
        root = await queryUid(nickname, webDeps);
      } catch {
        return fail(`查询野狐昵称「${nickname}」的 uid 失败`);
      }
      if (root === undefined) {
        return fail(`查不到野狐昵称「${nickname}」对应的 uid（接口返回失败或 uid 为空）`);
      }

      const allRows: FoxwqGameRow[] = [];
      const fetchedUids: string[] = [];
      let failedUids = 0;

      // 2. 抓主账号 pages 页。主账号失败也算一次失败，不静默吞。
      let rootGames: FoxwqGameRow[] | undefined;
      try {
        rootGames = await fetchUidGames(root.uid, pages, webDeps);
      } catch {
        return fail(`抓取主账号 uid=${root.uid} 的棋谱失败`);
      }
      if (rootGames === undefined) {
        failedUids += 1;
      } else {
        fetchedUids.push(root.uid);
        allRows.push(...rootGames);
      }

      // 3. 从已抓到的局里提取对手 uid（按出现局数降序、uid 升序去重，取前 opponentCount）。
      const expandedUids = maxHops === 2
        ? pickOpponents(allRows, root.uid, opponentCount)
        : [];

      // 4. maxHops===2 时对每个对手再抓 pages 页；单个失败跳过该 uid、其余继续。
      for (const uid of expandedUids) {
        let games: FoxwqGameRow[] | undefined;
        try {
          games = await fetchUidGames(uid, pages, webDeps);
        } catch {
          games = undefined;
        }
        if (games === undefined) {
          failedUids += 1;
          continue;
        }
        fetchedUids.push(uid);
        allRows.push(...games);
      }

      // 全部失败 / 查 uid 失败 → ok:false + 明确 observation；不静默吞、不编造数据。
      if (fetchedUids.length === 0) {
        return fail(`全部 uid 棋谱请求失败：抓取 ${fetchedUids.length} 个 uid / 共 0 局 / 失败 ${failedUids} 个，未取到任何数据`);
      }

      // 5. 所有局按 chessid 去重合并，保持首次出现顺序（确定性、可复算）。
      const seen = new Set<string>();
      const games: FoxwqGameRow[] = [];
      for (const row of allRows) {
        if (seen.has(row.chessid)) continue;
        seen.add(row.chessid);
        games.push(row);
      }

      const value: FoxwqBatchValue = {
        games,
        rootUid: root.uid,
        rootName: root.name,
        expandedUids,
        fetchedUids,
      };
      const summary = `抓取 ${fetchedUids.length} 个 uid / 共 ${games.length} 局 / 失败 ${failedUids} 个`
        + `（展开对手 ${expandedUids.length} 个）`;
      return {
        observation: `foxwq_fetch_batch：${summary}。结果作为纯 value 出参，业务正文未写入上下文。`,
        ok: true,
        detail: summary,
        value,
      };
    },
  }];
}
