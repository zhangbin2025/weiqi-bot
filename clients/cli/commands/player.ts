/**
 * player 命令
 * @module clients/cli/commands/player
 * @description 查询棋手信息、收藏管理，仅与应用层编排器交互
 */

import type { CliContext } from '../bootstrap';
import type { CliResult } from '../utils';

/** 顶层帮助 */
const PLAYER_HELP = `
usage: player <command> [options]

查询棋手等级分信息和收藏管理

commands:
  query <name>       查询棋手信息
  favorites          查看收藏列表
  clear              清除所有收藏

global options:
  --format FORMAT    输出格式: json | text (default: json)
  --debug            显示网络请求调试日志

examples:
  player query 柯洁
  player query 柯洁 --format text
  player favorites
  player clear
`;

/** query 子命令帮助 */
const QUERY_HELP = `
player query - 查询棋手信息

用法:
  player query <name>           查询指定棋手的等级分信息

参数:
  <name>                        棋手姓名（必填）

选项:
  --format json|text            输出格式（默认 json）
  --debug                       显示网络请求日志

输出:
  JSON 模式返回 { ok: true, data: { name, shoutan, yichafen, cachedAt } }
  text 模式返回格式化的文本

示例:
  player query 柯洁
  player query 马天放 --format text
`;

/** favorites 子命令帮助 */
const FAVORITES_HELP = `
player favorites - 查看收藏列表

用法:
  player favorites              显示所有已收藏的棋手

选项:
  --format json|text            输出格式（默认 json）
  --debug                       显示网络请求日志

输出:
  JSON 模式返回 { ok: true, data: [{ id, name, result, updatedAt }] }
  text 模式返回格式化的列表

示例:
  player favorites
  player favorites --format text
`;

/** clear 子命令帮助 */
const CLEAR_HELP = `
player clear - 清除所有收藏

用法:
  player clear                  清除所有棋手收藏

选项:
  --format json|text            输出格式（默认 json）
  --debug                       显示网络请求日志

输出:
  JSON 模式返回 { ok: true, data: { cleared: true } }
  text 模式返回操作结果

示例:
  player clear
`;

/** 执行 player query */
async function queryPlayer(name: string, ctx: CliContext): Promise<CliResult> {
  const { playerQuerier } = ctx;

  try {
    const result = await playerQuerier.query(name);
    // 去除 bookmarkId（CLI 不需要收藏功能）
    const { bookmarkId: _, ...data } = result;
    return { ok: true, command: 'player', data };
  } catch (e) {
    return { ok: false, command: 'player', error: `查询失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * 执行 player 命令
 * @param args - 命令参数，如 ['query', '柯洁']（已移除 --format 和 --debug）
 * @param ctx - CLI 运行时上下文
 */
export async function runPlayerCommand(args: string[], ctx: CliContext): Promise<CliResult> {
  const subCommand = args[0] ?? '';

  switch (subCommand) {
    case 'query': {
      // 检测 --help
      if (args.includes('--help') || args.includes('-h')) {
        return { ok: true, command: 'player-help', data: QUERY_HELP };
      }
      const name = args[1] ?? '';
      if (!name) {
        return { ok: false, command: 'player', error: '请提供棋手姓名，如: player query 柯洁' };
      }
      return queryPlayer(name, ctx);
    }

    case 'favorites': {
      // 检测 --help
      if (args.includes('--help') || args.includes('-h')) {
        return { ok: true, command: 'player-help', data: FAVORITES_HELP };
      }
      return getFavorites(ctx);
    }

    case 'clear': {
      // 检测 --help
      if (args.includes('--help') || args.includes('-h')) {
        return { ok: true, command: 'player-help', data: CLEAR_HELP };
      }
      return clearFavorites(ctx);
    }

    case 'help':
    case '--help':
    case '-h':
      return { ok: true, command: 'player-help', data: PLAYER_HELP };

    default:
      return { ok: false, command: 'player', error: `未知子命令: ${subCommand}\n${PLAYER_HELP}` };
  }
}

/** 获取收藏列表 */
async function getFavorites(ctx: CliContext): Promise<CliResult> {
  const { playerQuerier } = ctx;
  try {
    const favorites = await playerQuerier.getFavorites();
    return { ok: true, command: 'player-favorites', data: favorites };
  } catch (e) {
    return { ok: false, command: 'player-favorites', error: `获取收藏失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 清除所有收藏 */
async function clearFavorites(ctx: CliContext): Promise<CliResult> {
  const { playerQuerier } = ctx;
  try {
    await playerQuerier.clearFavorites();
    return { ok: true, command: 'player-clear', data: { cleared: true } };
  } catch (e) {
    return { ok: false, command: 'player-clear', error: `清除收藏失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}
