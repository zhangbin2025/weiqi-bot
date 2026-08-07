/**
 * decision 命令 — 实战选点题生成（从野狐公开棋谱）
 * @module clients/cli/commands/decision
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CliContext } from '../bootstrap';
import type { CliResult } from '../utils';
import type { IDecisionProblem } from '../../../domain/decision';

const DECISION_HELP = `
usage: decision [options]

从野狐公开棋谱生成实战选点题

options:
  --date <YYYY-MM-DD>  指定日期（默认昨天）
  --days <N>           最近 N 天（默认 1）
  --limit <N>          最多下载 N 盘棋（默认 50）
  --blunder-first      恶手题优先
  --difficulty <d>     难度筛选: easy | medium | hard | blunder
  --phase <p>          阶段筛选: layout | middle | endgame
  --format FORMAT      输出格式: json | text (default: json)
  --debug              显示网络请求调试日志

examples:
  decision
  decision --date 2026-07-28 --limit 20
  decision --days 3 --blunder-first
`;

export async function runDecisionCommand(args: string[], ctx: CliContext): Promise<CliResult> {
  // 帮助
  if (args.includes('--help') || args.includes('-h')) {
    return { ok: true, command: 'decision-help', data: DECISION_HELP };
  }

  let date: string | undefined;
  let days = 1;
  let limit = 50;
  let blunderFirst = false;
  let difficulty: string | undefined;
  let phase: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) date = args[++i];
    else if (args[i] === '--days' && args[i + 1]) days = parseInt(args[++i], 10);
    else if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[++i], 10);
    else if (args[i] === '--blunder-first') blunderFirst = true;
    else if (args[i] === '--difficulty' && args[i + 1]) difficulty = args[++i];
    else if (args[i] === '--phase' && args[i + 1]) phase = args[++i];
  }

  // 默认昨天
  if (!date && days === 1) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    date = d.toISOString().slice(0, 10);
  }

  try {
    const result = await ctx.decisionApp.generateFromOnlineWithOptions(
      date,
      limit,
      {
        difficulty: difficulty as any,
        phase: phase as any,
        blunderFirst,
      },
      (percent, status) => {
        process.stderr.write(`[decision] ${percent}% ${status}\n`);
      },
    );

    // 为每道题生成 SGF 文件
    const decisionDir = path.join(ctx.dataDir, 'decision');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputProblems: any[] = [];

    for (let i = 0; i < result.problems.length; i++) {
      const problem = result.problems[i];
      const sgf = problemToSgf(problem);
      const sgfPath = path.join(decisionDir, `problem-${timestamp}-${String(i + 1).padStart(3, '0')}.sgf`);
      fs.writeFileSync(sgfPath, sgf, 'utf-8');

      outputProblems.push({
        index: i + 1,
        id: problem.id,
        difficulty: problem.difficulty,
        phase: problem.phase,
        moveNumber: problem.metadata.moveNumber,
        turn: problem.turn,
        correctIndex: problem.correctIndex,
        options: problem.options.map((o, oi) => ({
          label: o.label,
          position: o.position,
          winrate: o.winrate,
          isCorrect: oi === problem.correctIndex,
        })),
        black: problem.metadata.playerBlack,
        white: problem.metadata.playerWhite,
        event: problem.metadata.event,
        sgfPath,
      });
    }

    const gameGroups = result.gameGroups.map(g => ({
      gameId: g.gameId,
      black: g.black,
      white: g.white,
      blackRank: g.blackRank,
      whiteRank: g.whiteRank,
      event: g.event,
      result: g.result,
      date: g.date,
      gameLevel: g.gameLevel,
      problemsCount: g.problemsCount,
    }));

    return {
      ok: true,
      command: 'decision-generate',
      data: {
        gamesCount: result.gamesCount,
        quizGamesCount: result.quizGamesCount,
        totalCount: result.problems.length,
        date,
        stats: result.stats,
        gameGroups,
        problems: outputProblems,
        favoriteId: result.favoriteId,
      },
    };
  } catch (e) {
    return { ok: false, command: 'decision', error: `选点题生成失败: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 将决策题转为 SGF（用分支表示选项 A/B/C/D） */
function problemToSgf(problem: IDecisionProblem): string {
  let sgf = '(;GM[1]FF[4]CA[UTF-8]SZ[19]\n';
  if (problem.metadata.playerBlack) sgf += `PB[${problem.metadata.playerBlack}]\n`;
  if (problem.metadata.playerWhite) sgf += `PW[${problem.metadata.playerWhite}]\n`;
  if (problem.metadata.event) sgf += `GC[${problem.metadata.event}]\n`;
  sgf += `C[选点题 难度:${problem.difficulty} 阶段:${problem.phase} 第${problem.metadata.moveNumber}手]\n`;

  if (Array.isArray(problem.position)) {
    for (const move of problem.position) {
      sgf += `;${move.color}[${move.coord}]\n`;
    }
  }

  const branches: string[] = [];
  for (const option of problem.options) {
    let branch = `(;${problem.turn}[${option.position}]`;
    const label = option.label;
    const isCorrect = problem.options.indexOf(option) === problem.correctIndex;
    let comment = `${label}: 胜率${option.winrate.toFixed(1)}%`;
    if (isCorrect) comment += ' ★正解';
    branch += `C[${comment}]`;

    if (option.variation && option.variation.length > 0) {
      for (const move of option.variation) {
        branch += `;${move.color}[${move.coord}]`;
      }
    }

    branch += ')';
    branches.push(branch);
  }

  if (branches.length > 0) {
    sgf += '\n' + branches.join('\n');
  }

  sgf += '\n)';
  return sgf;
}
