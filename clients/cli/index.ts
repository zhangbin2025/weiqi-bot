/**
 * CLI 入口 — 子命令路由
 * @module clients/cli
 *
 * 用法:
 *   npx tsx clients/cli/index.ts player query 柯洁
 *   npx tsx clients/cli/index.ts event list --area 广东省 --month 1
 *   npx tsx clients/cli/index.ts fetch download https://www.foxwq.com/qipu/share/xxx.html
 *   npx tsx clients/cli/index.ts joseki discover --sgf game.sgf
 *   npx tsx clients/cli/index.ts opponent analyze 柯洁
 *   npx tsx clients/cli/index.ts decision --date 2026-07-28
 */

import { runPlayerCommand } from './commands/player';
import { runJosekiCommand } from './commands/joseki';
import { runEventCommand } from './commands/event';
import { formatOk, formatError, formatTextOutput, extractDebug, type FormatType, type CliResult } from './utils';
import { runFetchCommand } from './commands/fetch';
import { runOpponentCommand } from './commands/opponent';
import { runDecisionCommand } from './commands/decision';
import { createCliContext } from './bootstrap';

const HELP = `
usage: weiqi-bot <command> [options]

围棋工具集：棋手查询、比赛查询、棋谱下载、定式发现、对手分析、实战选点

commands:
  player            棋手等级分查询
  event             云比赛赛事查询
  fetch             棋谱下载
  joseki            定式发现
  opponent          对手分析
  decision          实战选点题生成

global options:
  --format FORMAT   输出格式: json | text (default: json)
  --debug           显示网络请求调试日志

examples:
  player query 柯洁 --format text
  event list --area 广东省 --month 1
  fetch download https://www.foxwq.com/qipu/share/xxx.html
  joseki --date 2026-07-28 --limit 20
  opponent analyze 柯洁
  decision --date 2026-07-28 --limit 20

subcommand help:
  player --help     显示 player 命令帮助
  event --help      显示 event 命令帮助
  fetch --help      显示 fetch 命令帮助
  joseki --help     显示 joseki 命令帮助
  opponent --help   显示 opponent 命令帮助
  decision --help   显示 decision 命令帮助
`;

/** 从参数中提取 --format 并返回剩余参数 */
function extractFormat(args: string[]): { format: FormatType; rest: string[] } {
  const rest: string[] = [];
  let format: FormatType | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--format' && args[i + 1]) {
      const val = args[++i];
      if (val === 'json' || val === 'text') {
        format = val;
      }
    } else {
      rest.push(args[i]);
    }
  }

  // 如果用户没有指定 --format，根据 TTY 环境自动选择
  if (format === undefined) {
    format = process.stdout.isTTY ? 'text' : 'json';
  }

  return { format, rest };
}

/** 根据 format 类型格式化 CliResult */
function formatResult(result: CliResult, format: FormatType): string {
  if (format === 'text') {
    return formatTextOutput(result);
  }
  // json 模式
  if (result.ok) {
    return formatOk(result.data);
  }
  return formatError(result.error ?? '未知错误');
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const { debug, rest: afterDebug } = extractDebug(rawArgs);
  const { format, rest: args } = extractFormat(afterDebug);
  const command = args[0];
  const subArgs = args.slice(1);

  // 创建上下文，debug 模式下注册 NetworkLoggerPlugin
  const ctx = await createCliContext(debug);

  let result: CliResult;

  switch (command) {
    case 'player':
      result = await runPlayerCommand(subArgs, ctx);
      break;
    case 'event':
      result = await runEventCommand(subArgs, ctx);
      break;
    case 'fetch':
      result = await runFetchCommand(subArgs, ctx);
      break;
    case 'joseki':
      result = await runJosekiCommand(subArgs, ctx);
      break;
    case 'opponent':
      result = await runOpponentCommand(subArgs, ctx);
      break;
    case 'decision':
      result = await runDecisionCommand(subArgs, ctx);
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      console.log(HELP);
      return;
    default:
      result = { ok: false, command: 'unknown', error: `未知命令: ${command}\n${HELP}` };
  }

  console.log(formatResult(result, format));

  // debug 模式：输出网络请求摘要
  if (debug && ctx.loggerPlugin) {
    const logs = await ctx.loggerPlugin.getLogs();
    const okCount = logs.filter(l => l.success).length;
    const failCount = logs.length - okCount;
    const totalMs = logs.reduce((s, l) => s + (l.response?.duration ?? 0), 0);
    process.stderr.write(`\n[debug] === 网络请求摘要 ===\n`);
    process.stderr.write(`[debug] 共 ${logs.length} 个请求，成功 ${okCount}，失败 ${failCount}，总耗时 ${totalMs}ms\n`);
    for (let i = 0; i < logs.length; i++) {
      const e = logs[i];
      const mark = e.success ? '✓' : '✗';
      const dur = e.response?.duration ?? 0;
      const provider = e.provider.replace(/^Logger\[/, '').replace(/\]$/, '');
      const errStr = e.error ? ` error: ${e.error.message}` : '';
      process.stderr.write(`[debug] ${i + 1}. ${mark} ${e.request.method} ${e.request.url} ${dur}ms ${provider}${errStr}\n`);
    }
  }
}

main().catch((e: unknown) => {
  console.log(formatError(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
