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
    case 'event-help': return result.data as string;
    case 'joseki': return result.error ?? '未实现';
    case 'fetch-download': return formatFetchDownloadText(result.data as any);
    case 'fetch-history': return formatFetchHistoryText(result.data as any);
    case 'fetch-get': return formatFetchGetText(result.data as any);
    case 'fetch-help': return result.data as string;
    case 'joseki-discover': return formatJosekiDiscoverText(result.data as any);
    case 'joseki-help': return result.data as string;
    case 'opponent-analyze': return formatOpponentAnalyzeText(result.data as any);
    case 'opponent-history': return formatOpponentHistoryText(result.data as any);
    case 'opponent-help': return result.data as string;
    case 'decision-generate': return formatDecisionGenerateText(result.data as any);
    case 'decision-help': return result.data as string;
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


// === New command text formatters ===

function formatFetchDownloadText(data: any): string {
  const lines: string[] = [];
  if (!data) return '下载失败';
  lines.push('✓ 下载成功');
  const m = data.metadata;
  if (m) {
    const parts: string[] = [];
    if (m.blackName) parts.push(`黑: ${m.blackName}`);
    if (m.whiteName) parts.push(`白: ${m.whiteName}`);
    if (m.result) parts.push(`结果: ${m.result}`);
    if (parts.length > 0) lines.push('  ' + parts.join('  '));
  }
  lines.push(`  归档: ${data.archiveId}`);
  if (data.sgfPath) lines.push(`  SGF: ${data.sgfPath}`);
  if (data.fromCache) lines.push('  (来自缓存)');
  return lines.join('\n');
}

function formatFetchHistoryText(data: any): string {
  const lines: string[] = [];
  const entries = data?.entries ?? [];
  lines.push(`=== 下载历史 (${data?.total ?? 0} 条) ===`);
  lines.push('');
  if (entries.length === 0) {
    lines.push('暂无记录');
    return lines.join('\n');
  }
  lines.push('归档ID           黑方            白方            日期        结果');
  lines.push('--------------  --------------  --------------  ----------  ------');
  for (const e of entries) {
    const id = (e.archiveId || '').slice(0, 14).padEnd(14);
    const black = (e.black || '').slice(0, 14).padEnd(14);
    const white = (e.white || '').slice(0, 14).padEnd(14);
    const date = (e.date || '').slice(0, 10).padEnd(10);
    const result = (e.result || '').slice(0, 6);
    lines.push(`${id}  ${black}  ${white}  ${date}  ${result}`);
  }
  return lines.join('\n');
}

function formatFetchGetText(data: any): string {
  if (!data?.sgfContent) return '无 SGF 内容';
  return data.sgfContent;
}

function formatJosekiDiscoverText(data: any): string {
  const lines: string[] = [];
  const patterns = data?.patterns ?? [];
  lines.push(`发现 ${data?.totalPatterns ?? 0} 个定式 (${data?.gamesCount ?? 0} 个棋谱)`);
  lines.push('');
  for (const p of patterns) {
    const cornerMap: Record<string, string> = { tl: '左上', tr: '右上', bl: '左下', br: '右下' };
    const corner = cornerMap[p.corner] || p.corner || '?';
    const wr = p.winrateDelta !== undefined ? (p.winrateDelta >= 0 ? `+${p.winrateDelta.toFixed(1)}%` : `${p.winrateDelta.toFixed(1)}%`) : '';
    lines.push(`#${p.index}  ${corner}  频率:${p.frequency}  概率:${(p.probability * 100).toFixed(0)}%${wr ? '  胜率:' + wr : ''}`);
    if (p.thumbnail) {
      lines.push(p.thumbnail);
    }
    if (p.sgfPath) {
      lines.push(`  SGF: ${p.sgfPath}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function formatOpponentAnalyzeText(data: any): string {
  const lines: string[] = [];
  lines.push(`=== 对手分析: ${data?.userInfo?.nickname || data?.foxwqId} ===`);
  lines.push(`UID: ${data?.userInfo?.uid || data?.foxwqId}  昵称: ${data?.userInfo?.nickname || data?.foxwqId}`);
  lines.push('');

  const games = data?.games ?? [];
  if (games.length > 0) {
    let wins = 0, losses = 0, draws = 0;
    for (const g of games) {
      if (g.result?.startsWith('B+') || g.result?.startsWith('W+')) {
        // 简单统计
        wins++;
      }
    }
    lines.push(`对局: ${games.length}盘`);
    lines.push('');
    lines.push('对局列表:');
    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      lines.push(`  #${i + 1}  黑:${g.black} vs 白:${g.white}  ${g.result || '?'}  ${g.date || ''}`);
    }
    lines.push('');
    lines.push(`对局 SGF: ${data?.gamesDir}`);
  }

  const joseki = data?.joseki;
  if (joseki && joseki.count > 0) {
    lines.push('');
    lines.push(`定式发现: ${joseki.count}个`);
    for (const p of joseki.patterns ?? []) {
      const cornerMap: Record<string, string> = { tl: '左上', tr: '右上', bl: '左下', br: '右下' };
      const corner = cornerMap[p.corner] || p.corner || '?';
      const wr = p.winrateDelta !== undefined ? (p.winrateDelta >= 0 ? `+${p.winrateDelta.toFixed(1)}%` : `${p.winrateDelta.toFixed(1)}%`) : '';
      lines.push(`  #${p.index} ${corner} 频率:${p.frequency}${wr ? ' 胜率:' + wr : ''}${p.sgfPath ? ' SGF:' + p.sgfPath : ''}`);
    }
  }

  return lines.join('\n');
}

function formatOpponentHistoryText(data: any): string {
  const lines: string[] = [];
  const entries = data?.entries ?? [];
  lines.push(`=== 对手分析历史 (${data?.total ?? 0} 条) ===`);
  lines.push('');
  if (entries.length === 0) {
    lines.push('暂无记录');
    return lines.join('\n');
  }
  for (const e of entries) {
    const time = new Date(e.analyzedAt).toLocaleString('zh-CN');
    lines.push(`  ${e.foxwqId}  对局:${e.gamesCount}  定式:${e.patternsFound}  ${time}`);
  }
  return lines.join('\n');
}

function formatDecisionGenerateText(data: any): string {
  const lines: string[] = [];
  const problems = data?.problems ?? [];
  lines.push(`生成 ${data?.totalCount ?? 0} 道选点题`);

  // Online mode stats
  if (data?.gamesCount) {
    lines.push(`  棋谱: ${data.gamesCount}盘  有恶手题: ${data.quizGamesCount ?? 0}盘`);
  }
  if (data?.date) {
    lines.push(`  日期: ${data.date}`);
  }

  if (data?.stats) {
    const s = data.stats;
    // phases
    const phases: string[] = [];
    if (s.phases) {
      if (s.phases.layout) phases.push(`布局:${s.phases.layout}`);
      if (s.phases.middle) phases.push(`中盘:${s.phases.middle}`);
      if (s.phases.endgame) phases.push(`终盘:${s.phases.endgame}`);
    }
    // levels
    const levels: string[] = [];
    if (s.levels) {
      if (s.levels.pro) levels.push(`职业:${s.levels.pro}`);
      if (s.levels.high) levels.push(`高段:${s.levels.high}`);
      if (s.levels.normal) levels.push(`普通:${s.levels.normal}`);
    }
    if (phases.length > 0) lines.push('  ' + phases.join(' '));
    if (levels.length > 0) lines.push('  ' + levels.join(' '));
  }

  // Game groups (online mode)
  if (data?.gameGroups && data.gameGroups.length > 0) {
    lines.push('');
    lines.push('=== 棋谱分组 ===');
    for (const g of data.gameGroups) {
      const players = [g.black, g.white].filter(Boolean).join(' vs ');
      const rank = [g.blackRank, g.whiteRank].filter(Boolean).join('/');
      lines.push(`  ${players}${rank ? ' (' + rank + ')' : ''}  ${g.result || ''}  恶手:${g.problemsCount}${g.event ? '  ' + g.event : ''}`);
    }
  }

  lines.push('');
  lines.push('=== 题目列表 ===');
  for (const p of problems) {
    const phaseMap: Record<string, string> = { layout: '布局', middle: '中盘', endgame: '终盘' };
    const diffMap: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难', blunder: '恶手' };
    const phase = phaseMap[p.phase] || p.phase;
    const diff = diffMap[p.difficulty] || p.difficulty;
    const players = [p.black, p.white].filter(Boolean).join(' vs ') || '';
    lines.push(`#${p.index}  ${phase}  ${diff}  第${p.moveNumber}手${players ? '  ' + players : ''}`);
    // Show options
    if (p.options) {
      for (const o of p.options) {
        const mark = o.isCorrect ? '★' : ' ';
        lines.push(`  ${mark} ${o.label}: 胜率${(o.winrate ?? 0).toFixed(1)}%`);
      }
    }
    if (p.sgfPath) lines.push(`  SGF: ${p.sgfPath}`);
  }
  return lines.join('\n');
}
