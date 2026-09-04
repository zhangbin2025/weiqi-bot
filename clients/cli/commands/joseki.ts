/**
 * joseki 命令 — 定式发现与构建
 * @module clients/cli/commands/joseki
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CliContext } from '../bootstrap';
import type { CliResult } from '../utils';
import { TextBoardThumbnail } from '../../../presentation/adapters/cli/components/TextBoardThumbnail';
import { Board } from '../../../domain/board/Board';
import { SGFParser, coordToPos } from '../../../domain/sgf/SGFParser';
import { runJosekiBuildCommand } from './joseki-build.js';

const JOSEKI_HELP = `
usage: joseki <subcommand> [options]

围棋定式工具集

subcommands:
  discover          从野狐公开棋谱发现定式
  build             从 KataGo 棋谱构建定式库

examples:
  joseki discover --date 2026-07-28 --limit 20
  joseki build --mode auto
  joseki build --help
`;

const DISCOVER_HELP = `
usage: joseki discover [options]

从野狐公开棋谱发现定式

options:
  --date <YYYY-MM-DD>  指定日期（默认昨天）
  --limit <N>          最多下载 N 盘棋（默认 50）
`;

async function runJosekiDiscoverCommand(args: string[], ctx: CliContext): Promise<CliResult> {
  if (args.includes('--help') || args.includes('-h')) {
    return { ok: true, command: 'joseki-discover-help', data: DISCOVER_HELP };
  }

  let date: string | undefined;
  let limit = 50;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) date = args[++i];
    else if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[++i], 10);
  }

  if (!date) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    date = d.toISOString().slice(0, 10);
  }

  try {
    const result = await ctx.josekiDiscoverApp.discoverFromOnline(
      'foxwq',
      limit,
      (percent, status) => {
        process.stderr.write(`[joseki discover] ${percent}% ${status}\n`);
      },
    );

    const josekiDir = path.join(ctx.dataDir, 'joseki');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPatterns: any[] = [];

    for (let i = 0; i < result.patterns.length; i++) {
      const p = result.patterns[i];
      const sgfPath = path.join(josekiDir, `discover-${timestamp}-${String(i + 1).padStart(6, '0')}.sgf`);

      let sgf = '';
      if (p.extractedMoves) {
        sgf = p.extractedMoves;
      } else if (p.prefix) {
        sgf = '(;GM[1]FF[4]SZ[19]\n' + p.prefix + '\n)';
      }

      if (sgf) {
        fs.writeFileSync(sgfPath, sgf, 'utf-8');
      }

      let thumbnail = '';
      if (p.prefix) {
        try {
          const parser = new SGFParser();
          const parsed = parser.parse('(;GM[1]FF[4]SZ[19];' + p.prefix + ')');
          const board = new Board(19);
          for (const move of parsed.moves) {
            const pos = coordToPos(move.coord);
            if (pos) board.setStone(pos.x, pos.y, move.color === 'B' ? 'black' : 'white');
          }
          thumbnail = TextBoardThumbnail.renderCompact(board);
        } catch {}
      }

      outputPatterns.push({
        index: i + 1,
        corner: p.sourceCorner,
        frequency: p.frequency,
        probability: p.probability,
        winrateDelta: p.winrateDelta ?? p.winrateStats?.delta,
        prefix: p.prefix,
        sgfPath: sgf ? sgfPath : null,
        thumbnail,
      });
    }

    return {
      ok: true,
      command: 'joseki-discover',
      data: {
        totalPatterns: result.totalPatterns,
        gamesCount: result.gamesCount,
        date,
        games: result.games.map(g => ({
          archiveId: g.archiveId,
          black: g.black,
          white: g.white,
          date: g.date,
          result: g.result,
        })),
        patterns: outputPatterns,
      },
    };
  } catch (e) {
    return { ok: false, command: 'joseki-discover', error: '定式发现失败: ' + (e instanceof Error ? e.message : String(e)) };
  }
}

export async function runJosekiCommand(args: string[], ctx: CliContext): Promise<CliResult> {
  // ✅ 修复：先检查是否有子命令，再处理 --help
  const subcommand = args[0];
  
  // 如果第一个参数是已知子命令，则路由到子命令
  if (subcommand === 'discover') {
    return runJosekiDiscoverCommand(args.slice(1), ctx);
  }
  
  if (subcommand === 'build') {
    return runJosekiBuildCommand(args.slice(1), ctx);
  }
  
  // 其他情况（--help, -h, 无参数）返回主帮助
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    return { ok: true, command: 'joseki-help', data: JOSEKI_HELP };
  }
  
  // 未知子命令
  return { ok: false, command: 'joseki', error: '未知子命令: ' + subcommand + '\n' + JOSEKI_HELP };
}
