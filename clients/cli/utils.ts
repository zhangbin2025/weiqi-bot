/**
 * CLI 输出格式化工具
 * @module clients/cli/utils
 */

/** 从参数中提取 --debug 并返回剩余参数 */
export function extractDebug(args: string[]): { debug: boolean; rest: string[] } {
  const rest: string[] = args.filter(a => a !== '--debug');
  return { debug: rest.length < args.length, rest };
}

/** 成功输出（JSON 模式） */
export function formatOk(data: unknown): string {
  return JSON.stringify({ ok: true, data }, null, 2);
}

/** 失败输出（JSON 模式） */
export function formatError(message: string): string {
  return JSON.stringify({ ok: false, error: message }, null, 2);
}

/** 格式类型 */
export type FormatType = 'json' | 'text';

/** CLI 命令结构化返回值 */
export interface CliResult {
  ok: boolean;
  command: string;
  data?: unknown;
  error?: string;
}

/** 纯文本格式化：根据 command 类型分发 */
export function formatTextOutput(result: CliResult): string {
  if (!result.ok) {
    return `❌ ${result.error ?? '未知错误'}`;
  }

  switch (result.command) {
    case 'board': return formatBoardText(result.data as BoardTextData);
    case 'player': return formatPlayerText(result.data as PlayerTextData);
    case 'player-favorites': return formatPlayerFavoritesText(result.data as PlayerFavoriteItem[]);
    case 'player-clear': return formatPlayerClearText(result.data as PlayerClearData);
    case 'player-help': return result.data as string;
    case 'event-list': return formatEventListText(result.data as EventListTextData);
    case 'event-detail': return formatEventDetailText(result.data as EventDetailTextData);
    case 'event-ranking': return formatEventRankingText(result.data as EventRankingTextData);
    case 'event-matches': return formatEventMatchesText(result.data as EventMatchesTextData);
    case 'event-rounds': return formatEventRoundsText(result.data as EventRoundsTextData);
    case 'event-history': return formatEventHistoryText(result.data as EventHistoryTextData[]);
    case 'event-clear': return formatEventClearText(result.data as EventClearData);
    case 'event-opponent': return formatEventOpponentText(result.data as EventOpponentTextData);
    case 'board-help': return result.data as string;
    case 'event-help': return result.data as string;
    case 'joseki': return result.error ?? '未实现';
    default: return JSON.stringify(result.data, null, 2);
  }
}

// === 类型定义 ===

interface BoardTextData {
  size: number;
  moveCount: number;
  gameInfo: { black?: string; white?: string; result?: string };
  board: string;
  thumbnail: string;
  compact: string;
}

interface PlayerTextData {
  name: string;
  shoutan: {
    found: boolean;
    count: number;
    players: Array<{
      name: string;
      region: string;
      title: string;
      rating: number;
      rank: number;
      games: number;
      detailUrl?: string;
    }>;
    error?: string;
  };
  yichafen: {
    found: boolean;
    data?: {
      name: string;
      level: string;
      rating?: number;
      totalRank?: number;
      provinceRank?: number;
      cityRank?: number;
      province?: string;
      city?: string;
      gender?: string;
      birthYear?: number;
      notes?: string;
    };
    error?: string;
  };
  cachedAt?: string;
}

interface EventListTextData {
  events: Array<{
    id: number;
    title: string;
    city: string;
    date: string | null;
    players: number;
  }>;
  total: number;
  query?: { area?: string; month?: number; keyword?: string };
}

interface EventDetailTextData {
  eventId: number;
  groups: Array<{ id: number; name: string }>;
}

interface PlayerFavoriteItem {
  id: string;
  name: string;
  result?: PlayerTextData;
  updatedAt: number;
}

interface PlayerClearData {
  cleared: boolean;
}

// === 各命令的文本格式化 ===

function formatBoardText(data: BoardTextData): string {
  const lines: string[] = [];
  lines.push(`=== 棋盘 (${data.size}路, ${data.moveCount}手) ===`);

  if (data.gameInfo.black || data.gameInfo.white) {
    const parts: string[] = [];
    if (data.gameInfo.black) parts.push(`黑: ${data.gameInfo.black}`);
    if (data.gameInfo.white) parts.push(`白: ${data.gameInfo.white}`);
    lines.push(parts.join('  '));
  }

  if (data.gameInfo.result) {
    lines.push(`结果: ${data.gameInfo.result}`);
  }

  lines.push('');
  lines.push(data.board);
  lines.push('');
  lines.push('=== 缩略图 ===');
  lines.push(data.thumbnail);

  return lines.join('\n');
}

function formatPlayerText(data: PlayerTextData): string {
  const lines: string[] = [];
  let hasShoutan = data.shoutan.found && data.shoutan.players.length > 0;
  let hasYichafen = data.yichafen.found && data.yichafen.data;

  if (!hasShoutan && !hasYichafen) {
    lines.push(`棋手: ${data.name}`);
    lines.push('未找到相关数据');
    return lines.join('\n');
  }

  // ── 手谈等级分 ──
  if (hasShoutan) {
    lines.push('=== 手谈等级分 ===');
    lines.push(`已找到 ${data.shoutan.count} 人`);
    for (const p of data.shoutan.players) {
      lines.push(`  ${p.name} | ${p.title} | 等级分 ${p.rating} | 排名 #${p.rank} | ${p.region}`);
    }
    lines.push('');
  } else {
    lines.push('=== 手谈等级分 ===');
    lines.push(`未找到${data.shoutan.error ? ` (${data.shoutan.error})` : ''}`);
    lines.push('');
  }

  // ── 易查分 ──
  if (hasYichafen) {
    const y = data.yichafen.data!;
    lines.push('=== 易查分 ===');
    lines.push(`姓名：${y.name}`);
    if (y.level) lines.push(`段位：${y.level}`);
    if (y.gender) lines.push(`性别：${y.gender}`);
    if (y.birthYear) lines.push(`出生：${y.birthYear}`);
    if (y.province) lines.push(`省份：${y.province}`);
    if (y.city) lines.push(`城市：${y.city}`);
    if (y.rating !== undefined) lines.push(`等级分：${y.rating}`);
    if (y.totalRank !== undefined) lines.push(`总排名：#${y.totalRank}`);
    if (y.provinceRank !== undefined) lines.push(`省排名：#${y.provinceRank}`);
    if (y.cityRank !== undefined) lines.push(`市排名：#${y.cityRank}`);
    if (y.notes) {
      lines.push('');
      lines.push(`备注：${y.notes}`);
    }
  } else {
    lines.push('=== 易查分 ===');
    lines.push(`未找到${data.yichafen.error ? ` (${data.yichafen.error})` : ''}`);
  }

  return lines.join('\n');
}

function formatEventListText(data: EventListTextData): string {
  const lines: string[] = [];
  const events = data?.events ?? [];
  const total = data?.total ?? 0;

  if (data?.query) {
    const parts: string[] = [];
    if (data.query.area) parts.push(`地区: ${data.query.area}`);
    if (data.query.month) parts.push(`月份: ${data.query.month}`);
    if (data.query.keyword) parts.push(`关键词: ${data.query.keyword}`);
    if (parts.length > 0) lines.push(parts.join('  '));
  }

  lines.push(`找到 ${total} 场比赛`);
  lines.push('');

  if (events.length === 0) {
    lines.push('暂无比赛');
    return lines.join('\n');
  }

  // 表格格式
  lines.push('编号  ID      日期        城市    赛事名称');
  lines.push('----  ------  ----------  ------  ' + '-'.repeat(40));

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const dateStr = e.date ?? '日期待定';
    const num = String(i + 1).padStart(4);
    const id = String(e.id).padStart(6);
    const date = dateStr.padEnd(10);
    const city = e.city.slice(0, 6).padEnd(6);
    const title = e.title.length > 40 ? e.title.slice(0, 37) + '...' : e.title;
    lines.push(`${num}  ${id}  ${date}  ${city}  ${title}`);
  }

  return lines.join('\n');
}

function formatEventDetailText(data: EventDetailTextData): string {
  const lines: string[] = [];
  const eventId = data?.eventId ?? '未知';
  const groups = data?.groups ?? [];

  lines.push(`=== 赛事详情 (ID: ${eventId}) ===`);
  lines.push('');

  if (groups.length === 0) {
    lines.push('暂无分组信息');
    return lines.join('\n');
  }

  lines.push(`分组 (${groups.length}):`);
  lines.push('');
  lines.push('编号    名称');
  lines.push('------  ------------------');
  for (const g of groups) {
    const id = String(g.id).padStart(6);
    const name = g.name.length > 16 ? g.name.slice(0, 16) : g.name;
    lines.push(`${id}  ${name}`);
  }

  return lines.join('\n');
}

function formatPlayerFavoritesText(data: PlayerFavoriteItem[]): string {
  const lines: string[] = [];
  
  if (!data || data.length === 0) {
    lines.push('=== 棋手收藏 ===');
    lines.push('暂无收藏');
    return lines.join('\n');
  }

  lines.push(`=== 棋手收藏 (${data.length}) ===`);
  lines.push('');

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const num = String(i + 1).padStart(2);
    const name = item.name.padEnd(10);
    const parts: string[] = [`${num}. ${name}`];
    if (item.result) {
      const tags: string[] = [];
      if (item.result.shoutan.found && item.result.shoutan.players.length > 0) {
        tags.push(`等级分 ${item.result.shoutan.players[0].rating}`);
      }
      if (item.result.yichafen.found && item.result.yichafen.data) {
        tags.push(item.result.yichafen.data.level);
      }
      if (tags.length > 0) parts.push(tags.join('  '));
    }
    const time = new Date(item.updatedAt).toLocaleString('zh-CN');
    parts.push(time);
    lines.push(parts.join('  '));
  }

  return lines.join('\n');
}

function formatPlayerClearText(data: PlayerClearData): string {
  if (data.cleared) {
    return '已清除所有棋手收藏';
  }
  return '清除收藏失败';
}

// === Event 文本格式化类型定义 ===

interface EventRankingTextData {
  rankings: Array<{ rank: number; name: string; wins: number; losses: number; draws: number; score: number }>;
  totalRounds: number;
  completedRounds: number;
}

interface EventMatchesTextData {
  rows: Array<{ bout: number; p1Name: string; p2Name: string; p1Score: number; p2Score: number }>;
  totalBout: number;
}

interface EventRoundsTextData {
  matches: Array<{ bout: number; p1Name: string; p2Name: string; p1Score: number; p2Score: number }>;
  totalRounds: number;
  completedRounds: number;
}

interface EventHistoryTextData {
  id: string;
  eventId: number;
  title: string;
  visitedAt: number;
}

interface EventClearData {
  cleared: boolean;
}

interface EventStatsData {
  total: number;
  today: number;
}

interface EventOpponentTextData {
  player: string;
  matches: Array<{ bout: number; opponent: string; result?: string; color: string }>;
}

// === Event 文本格式化函数 ===

function formatEventRankingText(data: EventRankingTextData): string {
  const lines: string[] = [];
  const ranking = data?.rankings ?? [];
  const totalRounds = data?.totalRounds ?? 0;
  const completedRounds = data?.completedRounds ?? 0;

  if (totalRounds > 0) {
    lines.push(`=== 分组排名 (共 ${ranking.length} 人, ${completedRounds}/${totalRounds} 轮已完) ===`);
  } else {
    lines.push(`=== 分组排名 (${ranking.length} 人) ===`);
  }
  lines.push('');

  if (ranking.length === 0) {
    lines.push('暂无排名数据');
    return lines.join('\n');
  }

  // 表头
  lines.push('  排名  棋手            胜  负  和  积分');
  lines.push('  ----  --------------  --- --- --- ----');

  for (const p of ranking) {
    const name = p.name.length > 12 ? p.name.slice(0, 12) : p.name.padEnd(14);
    lines.push(`  ${String(p.rank).padStart(4)}  ${name}  ${String(p.wins).padStart(3)} ${String(p.losses).padStart(3)} ${String(p.draws).padStart(3)} ${String(p.score).padStart(4)}`);
  }

  return lines.join('\n');
}

function formatEventMatchesText(data: EventMatchesTextData): string {
  const lines: string[] = [];
  const rows = data?.rows ?? [];
  const totalBout = data?.totalBout ?? 0;

  lines.push(`=== 对阵表 (共 ${totalBout} 轮) ===`);
  lines.push('');

  if (rows.length === 0) {
    lines.push('暂无对阵数据');
    return lines.join('\n');
  }

  // 表格格式
  lines.push('黑方            白方            比分');
  lines.push('--------------  --------------  ----');

  for (const m of rows) {
    const black = m.p1Name.length > 12 ? m.p1Name.slice(0, 12) : m.p1Name.padEnd(14);
    const white = m.p2Name.length > 12 ? m.p2Name.slice(0, 12) : m.p2Name.padEnd(14);
    const score = `${m.p1Score}:${m.p2Score}`;
    lines.push(`${black}  ${white}  ${score}`);
  }

  return lines.join('\n');
}

function formatEventRoundsText(data: EventRoundsTextData): string {
  const lines: string[] = [];
  const matches = data?.matches ?? [];
  const totalRounds = data?.totalRounds ?? 0;
  const completedRounds = data?.completedRounds ?? 0;

  lines.push(`=== 所有轮次对阵 (${completedRounds}/${totalRounds} 轮已完) ===`);
  lines.push('');

  if (matches.length === 0) {
    lines.push('暂无对阵数据');
    return lines.join('\n');
  }

  // 按轮次分组
  const boutMap = new Map<number, typeof matches>();
  for (const m of matches) {
    const arr = boutMap.get(m.bout) ?? [];
    arr.push(m);
    boutMap.set(m.bout, arr);
  }

  const bouts = Array.from(boutMap.keys()).sort((a, b) => a - b);
  for (const bout of bouts) {
    const boutMatches = boutMap.get(bout)!;
    lines.push(`--- 第 ${bout} 轮 ---`);
    lines.push('黑方            白方            比分');
    lines.push('--------------  --------------  ----');
    for (const m of boutMatches) {
      const black = m.p1Name.length > 12 ? m.p1Name.slice(0, 12) : m.p1Name.padEnd(14);
      const white = m.p2Name.length > 12 ? m.p2Name.slice(0, 12) : m.p2Name.padEnd(14);
      const score = `${m.p1Score}:${m.p2Score}`;
      lines.push(`${black}  ${white}  ${score}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatEventHistoryText(data: EventHistoryTextData[]): string {
  const lines: string[] = [];
  const history = data ?? [];

  if (history.length === 0) {
    lines.push('=== 赛事访问历史 ===');
    lines.push('暂无访问记录');
    return lines.join('\n');
  }

  lines.push(`=== 赛事访问历史 (${history.length} 条) ===`);
  lines.push('');
  lines.push('编号  赛事名称                                访问时间');
  lines.push('----  ' + '-'.repeat(40) + '  ' + '-'.repeat(20));

  for (let i = 0; i < history.length; i++) {
    const item = history[i];
    const num = String(i + 1).padStart(4);
    const title = item.title.length > 40 ? item.title.slice(0, 37) + '...' : item.title.padEnd(40);
    const time = new Date(item.visitedAt).toLocaleString('zh-CN');
    lines.push(`${num}  ${title}  ${time}`);
  }

  return lines.join('\n');
}

function formatEventClearText(data: EventClearData): string {
  if (data.cleared) {
    return '已清空赛事访问历史';
  }
  return '清空历史失败';
}

function formatEventStatsText(data: EventStatsData): string {
  const lines: string[] = [];
  const total = data?.total ?? 0;
  const today = data?.today ?? 0;
  lines.push('=== 赛事统计 ===');
  lines.push(`总访问数: ${total}`);
  lines.push(`今日访问: ${today}`);
  return lines.join('\n');
}

function formatEventOpponentText(data: EventOpponentTextData): string {
  const lines: string[] = [];
  const player = data?.player ?? '未知';
  const matches = data?.matches ?? [];

  lines.push(`=== ${player} 对局详情 ===`);
  lines.push('');

  if (matches.length === 0) {
    lines.push('暂无对局数据');
    return lines.join('\n');
  }

  // 表格格式
  lines.push('轮次  对手              结果  执子');
  lines.push('----  ----------------  ----  ----');

  for (const m of matches) {
    const bout = String(m.bout).padStart(4);
    const opponent = m.opponent.length > 14 ? m.opponent.slice(0, 14) : m.opponent.padEnd(16);
    const result = m.result ? '✓' : '';
    const color = m.color || '-';
    lines.push(`${bout}  ${opponent}  ${result.padEnd(4)}  ${color}`);
  }

  return lines.join('\n');
}
