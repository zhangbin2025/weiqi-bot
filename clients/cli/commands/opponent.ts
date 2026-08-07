/**
 * opponent 命令 — 对手分析
 * @module clients/cli/commands/opponent
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CliContext } from '../bootstrap';
import type { CliResult } from '../utils';

const OPPONENT_HELP = `
usage: opponent <command> [options]

对手分析

commands:
  analyze <foxwqId>  分析对手（野狐 ID）
  history            查看分析历史

options:
  --max <N>          最多分析 N 盘棋（默认 10）
  --format FORMAT    输出格式: json | text (default: json)
  --debug            显示网络请求调试日志

examples:
  opponent analyze 柯洁
  opponent analyze 12345 --max 20
  opponent history
`;

export async function runOpponentCommand(args: string[], ctx: CliContext): Promise<CliResult> {
  const subCommand = args[0] ?? '';

  switch (subCommand) {
    case 'analyze': {
      const foxwqId = args[1];
      if (!foxwqId || foxwqId.startsWith('--')) {
        return { ok: false, command: 'opponent', error: '请提供野狐 ID，如: opponent analyze 柯洁' };
      }
      let maxGames = 10;
      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--max' && args[i + 1]) {
          maxGames = parseInt(args[++i], 10);
        }
      }
      return runOpponentAnalyze(foxwqId, maxGames, ctx);
    }
    case 'history': {
      return runOpponentHistory(ctx);
    }
    case 'help':
    case '--help':
    case '-h':
      return { ok: true, command: 'opponent-help', data: OPPONENT_HELP };
    default:
      return { ok: false, command: 'opponent', error: `未知子命令: ${subCommand}\n${OPPONENT_HELP}` };
  }
}

async function runOpponentAnalyze(foxwqId: string, maxGames: number, ctx: CliContext): Promise<CliResult> {
  try {
    const result = await ctx.opponentAnalyzer.analyze(foxwqId, {
      maxGames,
      onProgress: (percent, status, detail) => {
        process.stderr.write(`[opponent] ${percent}% ${status}${detail ? ` (${detail})` : ''}\n`);
      },
    });

    // 保存对局 SGF 到文件
    const opponentDir = path.join(ctx.dataDir, 'opponent', foxwqId);
    const gamesDir = path.join(opponentDir, 'games');
    fs.mkdirSync(gamesDir, { recursive: true });

    const gameFiles: string[] = [];
    for (const game of result.games) {
      if (game.sgf) {
        const sgfPath = path.join(gamesDir, `${game.archiveId || game.chessid}.sgf`);
        fs.writeFileSync(sgfPath, game.sgf, 'utf-8');
        gameFiles.push(sgfPath);
      }
    }

    // 保存定式 SGF
    const josekiDir = path.join(opponentDir, 'joseki');
    fs.mkdirSync(josekiDir, { recursive: true });

    const josekiFiles: string[] = [];
    for (let i = 0; i < result.joseki.patterns.length; i++) {
      const p = result.joseki.patterns[i];
      const sgf = p.extractedMoves || '';
      if (sgf) {
        const sgfPath = path.join(josekiDir, `pattern-${String(i + 1).padStart(3, '0')}.sgf`);
        fs.writeFileSync(sgfPath, sgf, 'utf-8');
        josekiFiles.push(sgfPath);
      }
    }

    return {
      ok: true,
      command: 'opponent-analyze',
      data: {
        foxwqId: result.foxwqId,
        userInfo: result.userInfo,
        gamesCount: result.games.length,
        games: result.games.map(g => ({
          chessid: g.chessid,
          black: g.black,
          white: g.white,
          date: g.date,
          result: g.result,
        })),
        gamesDir,
        joseki: {
          count: result.joseki.count,
          patterns: result.joseki.patterns.map((p, i) => ({
            index: i + 1,
            corner: p.sourceCorner,
            frequency: p.frequency,
            probability: p.probability,
            winrateDelta: p.winrateDelta ?? p.winrateStats?.delta,
            sgfPath: josekiFiles[i] || null,
          })),
        },
        josekiDir,
        analyzedAt: result.analyzedAt,
      },
    };
  } catch (e) {
    return { ok: false, command: 'opponent', error: `对手分析失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function runOpponentHistory(ctx: CliContext): Promise<CliResult> {
  try {
    const favoriteService = (ctx.opponentAnalyzer as any).favoriteService;
    if (!favoriteService) {
      return { ok: true, command: 'opponent-history', data: { total: 0, entries: [] } };
    }

    const favorites = await favoriteService.getFavorites({ category: 'opponent' });
    return {
      ok: true,
      command: 'opponent-history',
      data: {
        total: favorites.length,
        entries: favorites.slice(0, 50).map((f: any) => ({
          id: f.id,
          foxwqId: f.data?.foxwqId ?? f.key,
          gamesCount: f.data?.games?.length ?? 0,
          patternsFound: f.data?.joseki?.count ?? 0,
          analyzedAt: f.updatedAt,
        })),
      },
    };
  } catch (e) {
    return { ok: false, command: 'opponent', error: `查询历史失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}
