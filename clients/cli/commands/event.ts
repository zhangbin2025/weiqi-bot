/**
 * event 命令 — 查询赛事信息
 * @module clients/cli/commands/event
 * @description 仅与应用层编排器 EventQuerier 交互
 */

import type { CliContext } from '../bootstrap';
import type { CliResult } from '../utils';
import type { EventQueryOptions } from '../../../services/event/types';

/** 顶层帮助 */
const EVENT_HELP = `
usage: event <command> [options]

查询云比赛网赛事信息

commands:
  list              查询赛事列表
  detail            查询赛事详情
  ranking           查询分组排名
  opponent          查看棋手对手对局详情
  matches           查询对阵表
  rounds            查询所有轮次对阵
  history           查询访问历史
  clear             清空访问历史

global options:
  --format FORMAT   输出格式: json | text (default: json)
  --debug           显示网络请求调试日志

examples:
  event list --area 广东省 --month 1
  event detail --eventId 66261
  event ranking --eventId 66261 --groupId 327319
  event opponent --eventId 66261 --groupId 327319 --player 柯洁
  event matches --groupId 327319 --bout 1
  event rounds --groupId 327319
  event history --limit 10
  event clear
`;

/** list 子命令帮助 */
const LIST_HELP = `
event list - 查询赛事列表

用法:
  event list [--area <地区>] [--month <月>] [--keyword <关键词>]

参数:
  --area <地区>                  地区名称（如：广东省、北京市）
  --month <月>                   月份（1-12）
  --keyword <关键词>             搜索关键词

选项:
  --format json|text            输出格式（默认 json）
  --debug                       显示网络请求日志

输出:
  JSON 模式返回 { ok: true, data: { events: [...], total: N } }
  text 模式返回格式化的列表

示例:
  event list --area 广东省
  event list --area 广东省 --month 5 --format text
  event list --keyword 围甲
`;

/** detail 子命令帮助 */
const DETAIL_HELP = `
event detail - 查询赛事详情

用法:
  event detail --eventId <id> [--title <名称>]

参数:
  --eventId <id>                 赛事 ID（必填）
  --title <名称>                赛事名称（可选，用于记录访问历史）

选项:
  --format json|text            输出格式（默认 json）
  --debug                       显示网络请求日志

输出:
  JSON 模式返回 { ok: true, data: { eventId, groups: [...] } }
  text 模式返回格式化的详情

示例:
  event detail --eventId 66261
  event detail --eventId 66261 --title "深圳市宝安区业余围棋段级位赛" --format text
`;

/** ranking 子命令帮助 */
const RANKING_HELP = `
event ranking - 查询分组排名

用法:
  event ranking --eventId <id> --groupId <id> [--mode <模式>]

参数:
  --eventId <id>                 赛事 ID（必填）
  --groupId <id>                 分组 ID（必填）
  --mode <模式>                  排名模式（默认: default）

选项:
  --format json|text            输出格式（默认 json）
  --debug                       显示网络请求日志

输出:
  JSON 模式返回 { ok: true, data: { ranking: [...], summary: {...} } }
  text 模式返回格式化的排名表

示例:
  event ranking --eventId 66261 --groupId 327319
  event ranking --eventId 66261 --groupId 327319 --mode default --format text
`;

/** matches 子命令帮助 */
const MATCHES_HELP = `
event matches - 查询对阵表

用法:
  event matches --groupId <id> [--bout <轮次>]

参数:
  --groupId <id>                 分组 ID（必填）
  --bout <轮次>                  轮次号（默认: 1）

选项:
  --format json|text            输出格式（默认 json）
  --debug                       显示网络请求日志

输出:
  JSON 模式返回 { ok: true, data: { groupId, bout, matches: [...] } }
  text 模式返回格式化的对阵表

示例:
  event matches --groupId 327319
  event matches --groupId 327319 --bout 3 --format text
`;

/** rounds 子命令帮助 */
const ROUNDS_HELP = `
event rounds - 查询所有轮次对阵

用法:
  event rounds --groupId <id>

参数:
  --groupId <id>                 分组 ID（必填）

选项:
  --format json|text            输出格式（默认 json）
  --debug                       显示网络请求日志

输出:
  JSON 模式返回 { ok: true, data: { groupId, matches: [...] } }
  text 模式返回格式化的所有轮次对阵

示例:
  event rounds --groupId 327319
  event rounds --groupId 327319 --format text
`;

/** history 子命令帮助 */
const HISTORY_HELP = `
event history - 查询访问历史

用法:
  event history [--keyword <关键词>] [--limit <数量>]

参数:
  --keyword <关键词>             过滤关键词（可选）
  --limit <数量>                 返回条数（默认: 20）

选项:
  --format json|text            输出格式（默认 json）
  --debug                       显示网络请求日志

输出:
  JSON 模式返回 { ok: true, data: [{ id, eventId, title, visitedAt }] }
  text 模式返回格式化的历史列表

示例:
  event history
  event history --keyword 围甲 --limit 10 --format text
`;

/** clear 子命令帮助 */
const CLEAR_HELP = `
event clear - 清空访问历史

用法:
  event clear

选项:
  --format json|text            输出格式（默认 json）
  --debug                       显示网络请求日志

输出:
  JSON 模式返回 { ok: true, data: { cleared: true } }
  text 模式返回操作结果

示例:
  event clear
`;

/** stats 子命令帮助 */
const STATS_HELP = `
usage: event stats

获取赛事统计

options:
  --format FORMAT   输出格式: json | text (default: json)
  --debug           显示网络请求调试日志

examples:
  event stats
  event stats --format text
`;

/** opponent 子命令帮助 */
const OPPONENT_HELP = `
usage: event opponent --eventId ID --groupId ID --player NAME

查看赛事分组中某个棋手的对手对局详情

required arguments:
  --eventId ID      赛事 ID
  --groupId ID      分组 ID
  --player NAME     棋手姓名（支持模糊匹配）

options:
  --format FORMAT   输出格式: json | text (default: json)
  --debug           显示网络请求调试日志

examples:
  event opponent --eventId 66261 --groupId 327319 --player 柯洁
  event opponent --eventId 66261 --groupId 327319 --player 柯洁 --format text
`;

/** 已知参数列表（各子命令共用） */
const KNOWN_GLOBAL_FLAGS = new Set(['--format', '--debug', '--help', '-h']);

/** 检测未知参数，返回错误信息或 null */
function detectUnknownArgs(args: string[], knownParams: string[]): string | null {
  const allKnown = new Set([...knownParams, ...KNOWN_GLOBAL_FLAGS]);
  const unknown: string[] = [];
  for (const a of args) {
    if (a.startsWith('--') && !allKnown.has(a)) {
      unknown.push(a);
    }
  }
  return unknown.length > 0 ? `未知参数: ${unknown.join(', ')}` : null;
}

/** 解析 event list 参数 */
function parseListArgs(args: string[]): { area?: string; month?: number; keyword?: string; error?: string } {
  const knownParams = ['--area', '--month', '--keyword'];
  const unknownErr = detectUnknownArgs(args, knownParams);
  if (unknownErr) return { error: unknownErr };

  let area: string | undefined;
  let month: number | undefined;
  let keyword: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--area' && args[i + 1]) {
      area = args[++i];
    } else if (args[i] === '--month' && args[i + 1]) {
      month = parseInt(args[++i], 10);
    } else if (args[i] === '--keyword' && args[i + 1]) {
      keyword = args[++i];
    }
  }

  return { area, month, keyword };
}

/** 解析 event detail 参数 */
function parseDetailArgs(args: string[]): { eventId?: number; title?: string; error?: string } {
  const knownParams = ['--eventId', '--title'];
  const unknownErr = detectUnknownArgs(args, knownParams);
  if (unknownErr) return { error: unknownErr };

  let eventId: number | undefined;
  let title: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--eventId' && args[i + 1]) {
      eventId = parseInt(args[++i], 10);
    } else if (args[i] === '--title' && args[i + 1]) {
      title = args[++i];
    }
  }

  return { eventId, title };
}

/** 解析 event ranking 参数 */
function parseRankingArgs(args: string[]): { eventId?: number; groupId?: number; mode?: string; error?: string } {
  const knownParams = ['--eventId', '--groupId', '--mode'];
  const unknownErr = detectUnknownArgs(args, knownParams);
  if (unknownErr) return { error: unknownErr };

  let eventId: number | undefined;
  let groupId: number | undefined;
  let mode: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--eventId' && args[i + 1]) {
      eventId = parseInt(args[++i], 10);
    } else if (args[i] === '--groupId' && args[i + 1]) {
      groupId = parseInt(args[++i], 10);
    } else if (args[i] === '--mode' && args[i + 1]) {
      mode = args[++i];
    }
  }

  return { eventId, groupId, mode };
}

/** 解析 event matches 参数 */
function parseMatchesArgs(args: string[]): { groupId?: number; bout?: number; error?: string } {
  const knownParams = ['--groupId', '--bout'];
  const unknownErr = detectUnknownArgs(args, knownParams);
  if (unknownErr) return { error: unknownErr };

  let groupId: number | undefined;
  let bout: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--groupId' && args[i + 1]) {
      groupId = parseInt(args[++i], 10);
    } else if (args[i] === '--bout' && args[i + 1]) {
      bout = parseInt(args[++i], 10);
    }
  }

  return { groupId, bout };
}

/** 解析 event history 参数 */
function parseHistoryArgs(args: string[]): { keyword?: string; limit?: number; error?: string } {
  const knownParams = ['--keyword', '--limit'];
  const unknownErr = detectUnknownArgs(args, knownParams);
  if (unknownErr) return { error: unknownErr };

  let keyword: string | undefined;
  let limit: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--keyword' && args[i + 1]) {
      keyword = args[++i];
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    }
  }

  return { keyword, limit };
}

/** 执行 event list */
async function listEvents(
  area: string | undefined,
  month: number | undefined,
  keyword: string | undefined,
  ctx: CliContext,
): Promise<CliResult> {
  const { eventQuerier } = ctx;

  try {
    const options: EventQueryOptions = { area: area ?? '', month: month ?? 1, keyword: keyword ?? '' };
    const result = await eventQuerier.queryEvents(options);
    return {
      ok: true,
      command: 'event-list',
      data: {
        ...result,
        query: { area, month, keyword },
      },
    };
  } catch (e) {
    return { ok: false, command: 'event-list', error: `赛事列表查询失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 执行 event detail */
async function eventDetail(eventId: number, title: string | undefined, ctx: CliContext): Promise<CliResult> {
  const { eventQuerier } = ctx;

  try {
    const result = await eventQuerier.getEventDetail(eventId);
    // 记录访问历史
    const eventTitle = title ?? `赛事 #${eventId}`;
    await eventQuerier.recordVisited(eventId, eventTitle).catch(() => {});
    return { ok: true, command: 'event-detail', data: result };
  } catch (e) {
    return { ok: false, command: 'event-detail', error: `赛事详情查询失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 执行 event ranking */
async function eventRanking(
  eventId: number,
  groupId: number,
  mode: string | undefined,
  ctx: CliContext,
): Promise<CliResult> {
  const { eventQuerier } = ctx;

  try {
    const result = await eventQuerier.getGroupRanking(eventId, groupId, mode as 'default' | undefined);
    return { ok: true, command: 'event-ranking', data: result };
  } catch (e) {
    return { ok: false, command: 'event-ranking', error: `分组排名查询失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 执行 event matches */
async function eventMatches(
  groupId: number,
  bout: number | undefined,
  ctx: CliContext,
): Promise<CliResult> {
  const { eventQuerier } = ctx;

  try {
    const result = await eventQuerier.getGroupMatches(groupId, bout);
    return { ok: true, command: 'event-matches', data: result };
  } catch (e) {
    return { ok: false, command: 'event-matches', error: `对阵表查询失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 执行 event rounds */
async function eventRounds(groupId: number, ctx: CliContext): Promise<CliResult> {
  const { eventQuerier } = ctx;

  try {
    const result = await eventQuerier.getAllRounds(groupId);
    return { ok: true, command: 'event-rounds', data: result };
  } catch (e) {
    return { ok: false, command: 'event-rounds', error: `轮次对阵查询失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 执行 event history */
async function eventHistory(
  keyword: string | undefined,
  limit: number | undefined,
  ctx: CliContext,
): Promise<CliResult> {
  const { eventQuerier } = ctx;

  try {
    const result = await eventQuerier.queryHistory({ keyword, limit });
    return { ok: true, command: 'event-history', data: result };
  } catch (e) {
    return { ok: false, command: 'event-history', error: `访问历史查询失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 执行 event clear */
async function eventClear(ctx: CliContext): Promise<CliResult> {
  const { eventQuerier } = ctx;

  try {
    await eventQuerier.clearHistory();
    return { ok: true, command: 'event-clear', data: { cleared: true } };
  } catch (e) {
    return { ok: false, command: 'event-clear', error: `清空历史失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 执行 event stats */
async function eventStats(ctx: CliContext): Promise<CliResult> {
  const { eventQuerier } = ctx;

  try {
    const result = await eventQuerier.getStats();
    return { ok: true, command: 'event-stats', data: result };
  } catch (e) {
    return { ok: false, command: 'event-stats', error: `统计查询失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 解析 event opponent 参数 */
function parseOpponentArgs(args: string[]): { eventId?: number; groupId?: number; player?: string; error?: string } {
  const knownParams = ['--eventId', '--groupId', '--player'];
  const unknownErr = detectUnknownArgs(args, knownParams);
  if (unknownErr) return { error: unknownErr };

  let eventId: number | undefined;
  let groupId: number | undefined;
  let player: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--eventId' && args[i + 1]) {
      eventId = parseInt(args[++i], 10);
    } else if (args[i] === '--groupId' && args[i + 1]) {
      groupId = parseInt(args[++i], 10);
    } else if (args[i] === '--player' && args[i + 1]) {
      player = args[++i];
    }
  }

  return { eventId, groupId, player };
}

/** 执行 event opponent */
async function eventOpponent(
  eventId: number,
  groupId: number,
  playerName: string,
  ctx: CliContext,
): Promise<CliResult> {
  const { eventQuerier } = ctx;

  try {
    const roundsResult = await eventQuerier.getAllRounds(groupId);
    const matches = roundsResult.matches;

    // 筛选包含该棋手的对局
    const playerMatches = matches
      .filter(m => m.p1Name.includes(playerName) || m.p2Name.includes(playerName))
      .map(m => {
        const isP1 = m.p1Name.includes(playerName);
        return {
          bout: m.bout,
          opponent: isP1 ? m.p2Name : m.p1Name,
          result: isP1 ? (m.p1Score > m.p2Score ? '胜' : m.p1Score < m.p2Score ? '负' : '和')
                       : (m.p2Score > m.p1Score ? '胜' : m.p2Score < m.p1Score ? '负' : '和'),
          color: isP1 ? '黑' : '白',
        };
      });

    return {
      ok: true,
      command: 'event-opponent',
      data: {
        player: playerName,
        matches: playerMatches,
      },
    };
  } catch (e) {
    return { ok: false, command: 'event-opponent', error: `对手查询失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * 执行 event 命令
 * @param args - 命令参数（已移除 --format 和 --debug）
 * @param ctx - CLI 运行时上下文
 */
export async function runEventCommand(args: string[], ctx: CliContext): Promise<CliResult> {
  const subCommand = args[0] ?? '';

  switch (subCommand) {
    case 'list': {
      if (args.includes('--help') || args.includes('-h')) {
        return { ok: true, command: 'event-help', data: LIST_HELP };
      }
      const parsed = parseListArgs(args.slice(1));
      if (parsed.error) {
        return { ok: false, command: 'event-list', error: parsed.error };
      }
      return listEvents(parsed.area, parsed.month, parsed.keyword, ctx);
    }

    case 'detail': {
      if (args.includes('--help') || args.includes('-h')) {
        return { ok: true, command: 'event-help', data: DETAIL_HELP };
      }
      const parsed = parseDetailArgs(args.slice(1));
      if (parsed.error) {
        return { ok: false, command: 'event-detail', error: parsed.error };
      }
      if (!parsed.eventId) {
        return { ok: false, command: 'event-detail', error: '缺少参数: --eventId' };
      }
      return eventDetail(parsed.eventId, parsed.title, ctx);
    }

    case 'ranking': {
      if (args.includes('--help') || args.includes('-h')) {
        return { ok: true, command: 'event-help', data: RANKING_HELP };
      }
      const parsed = parseRankingArgs(args.slice(1));
      if (parsed.error) {
        return { ok: false, command: 'event-ranking', error: parsed.error };
      }
      const missing: string[] = [];
      if (!parsed.eventId) missing.push('--eventId');
      if (!parsed.groupId) missing.push('--groupId');
      if (missing.length > 0) {
        return { ok: false, command: 'event-ranking', error: `缺少参数: ${missing.join(', ')}` };
      }
      return eventRanking(parsed.eventId, parsed.groupId, parsed.mode, ctx);
    }

    case 'matches': {
      if (args.includes('--help') || args.includes('-h')) {
        return { ok: true, command: 'event-help', data: MATCHES_HELP };
      }
      const parsed = parseMatchesArgs(args.slice(1));
      if (parsed.error) {
        return { ok: false, command: 'event-matches', error: parsed.error };
      }
      if (!parsed.groupId) {
        return { ok: false, command: 'event-matches', error: '缺少参数: --groupId' };
      }
      return eventMatches(parsed.groupId, parsed.bout, ctx);
    }

    case 'rounds': {
      if (args.includes('--help') || args.includes('-h')) {
        return { ok: true, command: 'event-help', data: ROUNDS_HELP };
      }
      const parsed = parseMatchesArgs(args.slice(1));
      if (parsed.error) {
        return { ok: false, command: 'event-rounds', error: parsed.error };
      }
      if (!parsed.groupId) {
        return { ok: false, command: 'event-rounds', error: '缺少参数: --groupId' };
      }
      return eventRounds(parsed.groupId, ctx);
    }

    case 'history': {
      if (args.includes('--help') || args.includes('-h')) {
        return { ok: true, command: 'event-help', data: HISTORY_HELP };
      }
      const parsed = parseHistoryArgs(args.slice(1));
      if (parsed.error) {
        return { ok: false, command: 'event-history', error: parsed.error };
      }
      return eventHistory(parsed.keyword, parsed.limit, ctx);
    }

    case 'clear': {
      if (args.includes('--help') || args.includes('-h')) {
        return { ok: true, command: 'event-help', data: CLEAR_HELP };
      }
      return eventClear(ctx);
    }

    case 'stats': {
      if (args.includes('--help') || args.includes('-h')) {
        return { ok: true, command: 'event-help', data: STATS_HELP };
      }
      return eventStats(ctx);
    }

    case 'opponent': {
      if (args.includes('--help') || args.includes('-h')) {
        return { ok: true, command: 'event-help', data: OPPONENT_HELP };
      }
      const parsed = parseOpponentArgs(args.slice(1));
      if (parsed.error) {
        return { ok: false, command: 'event-opponent', error: parsed.error };
      }
      const missing: string[] = [];
      if (!parsed.eventId) missing.push('--eventId');
      if (!parsed.groupId) missing.push('--groupId');
      if (!parsed.player) missing.push('--player');
      if (missing.length > 0) {
        return { ok: false, command: 'event-opponent', error: `缺少参数: ${missing.join(', ')}` };
      }
      return eventOpponent(parsed.eventId, parsed.groupId, parsed.player, ctx);
    }

    case 'help':
    case '--help':
    case '-h':
      return { ok: true, command: 'event-help', data: EVENT_HELP };

    default:
      return { ok: false, command: 'event', error: `未知子命令: ${subCommand}\n${EVENT_HELP}` };
  }
}
