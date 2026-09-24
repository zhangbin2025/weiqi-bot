/**
 * review 命令 — 本地棋谱远程 AI 复盘(纯客户端)
 * @module clients/cli/commands/review
 *
 * 通过 WebRTC 隧道连接远程服务端 KataGo 算力,分析本地/下载的棋谱。
 * 基本功能对齐 clients/web/review,但:
 *   - 算力来自远程(KataGoRemoteEngine),本地不跑 KataGo;
 *   - 默认只做整盘快速评估(胜率曲线 + 每手候选选点概览),不逐手深算;
 *   - 提供「分析局面」:对任意一手指定局面获取 AI 推荐选点(深算)。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CliContext } from '../bootstrap';
import type { CliResult } from '../utils';
import { CliRemoteKataGoEngine } from '../remote-runtime';
import { SGFParser } from '../../../domain/sgf/SGFParser';
import { KataGoQueryBuilder } from '../../../infrastructure/katago/KataGoQueryBuilder';
import type { GameTurnAnalysis } from '../../../infrastructure/ai/IAIEngine';
import { sgfColorToPlayerColor } from '../../../domain/primitives';

console.error('[review] MODULE LOADED');

const DEFAULT_SIGNALING = 'wss://api.weiqi.lol/ws/signal';
const DEFAULT_PASSWORD = "";

const REVIEW_HELP = `
usage: review <command> [options]

本地棋谱远程 AI 复盘(纯客户端,算力来自远程 KataGo 服务端)

commands:
  analyze <sgf路径|棋谱URL>   分析一盘棋(整盘快速评估 + 胜率图)

options:
  --password ***          隧道密码(默认 111111)
  --signaling <url>       信令服务器(默认 wss://api.weiqi.lol/ws/signal)
  --visits <n>            深算算力(0=快速批量评估,默认 0)
  --top-k <n>             候选选点数(默认 5)
  --mode quick|deep       分析模式(默认 quick)
  --analyze-move <n>      额外深算某一手(如 23);可多次
  --format json|text      输出格式(默认 json)
  --debug                 显示连接/网络调试日志

示例:
  review analyze ./game.sgf
  review analyze https://.../x.sgf --top-k 5 --format text
  review analyze ./game.sgf --analyze-move 50 --analyze-move 120
`;

interface ReviewArgs {
  sgf: string;
  password: string;
  signaling: string;
  visits: number;
  topK: number;
  mode: 'quick' | 'deep';
  analyzeMoves: number[];
  format: 'json' | 'text';
  debug: boolean;
}

function parseArgs(args: string[]): ReviewArgs {
  const res: ReviewArgs = {
    sgf: '',
    password: DEFAULT_PASSWORD,
    signaling: DEFAULT_SIGNALING,
    visits: 0,
    topK: 5,
    mode: 'quick',
    analyzeMoves: [],
    format: process.stdout.isTTY ? 'text' : 'json',
    debug: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--password' && args[i + 1]) res.password = args[++i];
    else if (a === '--signaling' && args[i + 1]) res.signaling = args[++i];
    else if (a === '--visits' && args[i + 1]) res.visits = parseInt(args[++i], 10) || 0;
    else if (a === '--top-k' && args[i + 1]) res.topK = parseInt(args[++i], 10) || 5;
    else if (a === '--mode' && args[i + 1]) res.mode = args[++i] as 'quick' | 'deep';
    else if (a === '--analyze-move' && args[i + 1]) res.analyzeMoves.push(parseInt(args[++i], 10));
    else if (a === '--format' && args[i + 1]) res.format = args[++i] as 'json' | 'text';
    else if (a === '--debug') res.debug = true;
    else if (!a.startsWith('--') && !res.sgf) res.sgf = a;
  }
  return res;
}

/** 取 SGF:本地文件直接读;URL 用 GameService 下载 */
async function resolveSgf(sgfArg: string, ctx: CliContext, debug: boolean): Promise<string> {
  if (fs.existsSync(sgfArg)) {
    return fs.readFileSync(sgfArg, 'utf-8');
  }
  if (/^https?:\/\//.test(sgfArg)) {
    const r = await ctx.gameService.fetch(sgfArg);
    if (!r.success || !r.sgfContent) {
      throw new Error('棋谱下载失败: ' + (r.error ?? '未知错误'));
    }
    return r.sgfContent;
  }
  throw new Error('找不到棋谱: ' + sgfArg + ' (请提供本地路径或 http(s) URL)');
}

/** 解析 SGF 为着法列表 + 元信息 */
function parseSgf(sgf: string) {
  const parsed = new SGFParser().parse(sgf);
  const info = parsed.gameInfo;
  const moves = parsed.moves.map((m: any) => {
    if (!m.coord || m.coord.length < 2 || m.coord === 'tt') {
      return { x: -1, y: -1, color: sgfColorToPlayerColor(m.color as 'B' | 'W') };
    }
    return {
      x: m.coord.charCodeAt(0) - 97,
      y: m.coord.charCodeAt(1) - 97,
      color: sgfColorToPlayerColor(m.color as 'B' | 'W'),
    };
  });
  const parsedKomi = parseFloat(info.komi);
  const komi = Number.isNaN(parsedKomi) ? 7.5 : parsedKomi;
  return { moves, komi, info, boardSize: info.boardSize ?? 19 };
}

/** 重建某手之前的棋盘(用于单局面深算) */
function rebuildBoard(moves: Array<{ x: number; y: number; color: any }>, upto: number, size: number): Uint8Array {
  const board = new Uint8Array(size * size); // 0 empty, 1 black, 2 white
  const idx = (x: number, y: number) => y * size + x;
  for (let i = 0; i < upto && i < moves.length; i++) {
    const m = moves[i];
    if (m.x < 0 || m.y < 0) continue; // pass
    board[idx(m.x, m.y)] = m.color === 'black' ? 1 : 2;
  }
  return board;
}

/** 坐标转中文棋谱坐标(如 Q16) */
function coordToLabel(x: number, y: number, size: number): string {
  if (x < 0 || y < 0) return 'PASS';
  const col = String.fromCharCode(x >= 8 ? 66 + x : 65 + x);
  const row = size - y;
  return col + row;
}

/** 黑方胜率 - 柱状图(文本) */
function winRateBar(blackWinRate: number, width = 40): string {
  const b = Math.max(0, Math.min(1, blackWinRate));
  const filled = Math.round(b * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** 生成全文胜率图(text 模式) */
function renderWinRateChart(perMove: Array<{ n: number; color: string; bwr: number; sl: number }>): string {
  const lines: string[] = [];
  lines.push('手   执  黑胜率  目差   胜率图(黑█ 白░)');
  lines.push('---  ---  ------  -----  ' + '-'.repeat(40));
  for (const mv of perMove) {
    const num = String(mv.n).padStart(3);
    const color = mv.color === 'black' ? '黑' : '白';
    const bwr = (mv.bwr * 100).toFixed(1).padStart(5);
    const sl = (mv.sl >= 0 ? '+' : '') + mv.sl.toFixed(1).padStart(5);
    lines.push(`${num}  ${color}   ${bwr}%  ${sl}  ${winRateBar(mv.bwr)}`);
  }
  return lines.join('\n');
}

async function runAnalyze(args: ReviewArgs, ctx: CliContext): Promise<CliResult> {
  try {
    if (args.debug) console.error('[review] runAnalyze start, sgf=', args.sgf);
    const sgf = await resolveSgf(args.sgf, ctx, args.debug);
    if (args.debug) console.error('[review] sgf loaded, len=', sgf.length);
    const { moves, komi, info, boardSize } = parseSgf(sgf);

    if (moves.length === 0) {
      return { ok: false, command: 'review', error: '棋谱无着法' };
    }

    const engine = new CliRemoteKataGoEngine(args.signaling, args.password);
    if (args.debug) console.error('[review] 连接远程服务端...');
    await engine.connect();
    await engine.init();
    const engineInfo = engine.getEngineInfo();
    if (args.debug) console.error('[review] 引擎信息:', JSON.stringify(engineInfo));

    // 整盘批量分析(快速)
    if (args.debug) console.error(`[review] 整盘分析 ${moves.length} 手...`);
    const analyzeTurns = Array.from({ length: moves.length }, (_, i) => i);
    const gameOpts: any = {
      moves: moves.map((m) => ({ player: m.color, x: m.x, y: m.y })),
      komi,
      rules: 'chinese',
      analyzeTurns,
      includeOwnership: false,
      analysisPVLen: 0,
      boardXSize: boardSize,
      boardYSize: boardSize,
      onResultProgress: (c: number, t: number) => {
        if (c % Math.max(1, Math.floor(t / 20)) === 0 || c === t) {
          process.stderr.write(`\r[review] 分析进度 ${c}/${t}`);
        }
      },
    };
    const turns: GameTurnAnalysis[] = await engine.analyzeGame(gameOpts);
    process.stderr.write('\n');

    // 整理每手胜率/目差 + 候选选点
    const perMove = turns.map((t, i) => {
      const m = moves[i];
      return {
        n: i + 1,
        color: m.color,
        bwr: t.rootWinRate,
        sl: t.rootScoreLead,
        topMoves: t.moveInfos.slice(0, args.topK).map((mi) => {
          const c = KataGoQueryBuilder.gtpToMove(mi.move, boardSize);
          return { label: coordToLabel(c.x, c.y, boardSize), winRate: mi.winrate, scoreLead: mi.scoreLead, visits: mi.visits };
        }),
      };
    });

    // 额外深算指定手(默认不逐手深算,避免慢)
    const deepByMove: Record<number, any> = {};
    for (const mvNum of args.analyzeMoves) {
      if (mvNum < 1 || mvNum > moves.length) continue;
      const i = mvNum - 1;
      const board = rebuildBoard(moves, i, boardSize);
      const prevBoard = i > 0 ? rebuildBoard(moves, i - 1, boardSize) : null;
      const currentPlayer = moves[i].color;
      const moveHistory = moves.slice(0, i).map((m) => ({ x: m.x, y: m.y, player: m.color }));
      const opts: any = {
        board,
        previousBoard: prevBoard,
        currentPlayer,
        moveHistory,
        komi,
        topK: args.topK,
        visits: args.visits > 0 ? args.visits : 100,
        includePv: true,
        analysisPVLen: 15,
        boardXSize: boardSize,
        boardYSize: boardSize,
      };
      const r = await engine.analyze(opts as any);
      deepByMove[mvNum] = r;
    }

    const result: any = {
      gameInfo: { black: info.black, white: info.white, komi, result: info.result },
      totalMoves: moves.length,
      engineInfo,
      perMove,
      deepByMove,
    };

    engine.disconnect();
    return { ok: true, command: 'review-analyze', data: result };
  } catch (e) {
    return { ok: false, command: 'review', error: e instanceof Error ? e.message : String(e) };
  }
}

export async function runReviewCommand(args: string[], ctx: CliContext): Promise<CliResult> {
  console.error('[review] runReviewCommand sub=', args[0]);
  const sub = args[0] ?? '';
  if (sub === 'help' || sub === '--help' || sub === '-h') {
    return { ok: true, command: 'review-help', data: REVIEW_HELP };
  }
  if (sub === 'analyze') {
    const parsed = parseArgs(args.slice(1));
    console.error('[review] parsed sgf=', parsed.sgf, 'debug=', parsed.debug);
    return runAnalyze(parsed, ctx);
  }
  return { ok: false, command: 'review', error: `未知子命令: ${sub}\n${REVIEW_HELP}` };
}

/** text 格式化(供 utils.formatTextOutput 调用) */
export function formatReviewAnalyzeText(data: any): string {
  const lines: string[] = [];
  const g = data.gameInfo || {};
  lines.push(`=== 复盘分析: ${g.black ?? '?'} vs ${g.white ?? '?'} (${data.totalMoves}手) ===`);
  if (g.komi !== undefined) lines.push(`贴目: ${g.komi}  结果: ${g.result ?? '未知'}`);
  lines.push('');
  lines.push(renderWinRateChart(data.perMove));
  lines.push('');
  lines.push('=== 每手 AI 候选选点(前' + (data.perMove[0]?.topMoves?.length ?? 0) + ') ===');
  for (const mv of data.perMove) {
    const top = mv.topMoves
      .map((t: any) => `${t.label}(${(t.winRate * 100).toFixed(1)}%/+${t.scoreLead.toFixed(1)})`)
      .join('  ');
    lines.push(`#${mv.n} ${mv.color === 'black' ? '黑' : '白'}: ${top}`);
  }
  const deepKeys = Object.keys(data.deepByMove || {});
  if (deepKeys.length > 0) {
    lines.push('');
    lines.push('=== 深算指定局面(AI 推荐选点) ===');
    for (const k of deepKeys) {
      const d = data.deepByMove[k];
      const items = (d.moveInfos || d.candidates || []).slice(0, 5).map((mi: any) => {
        const label = mi.move ? coordToLabel(...Object.values(KataGoQueryBuilder.gtpToMove(mi.move, 19))) : mi.label;
        const wr = (mi.winrate ?? mi.winRate) * 100;
        const sl = (mi.scoreLead ?? mi.scoreLead).toFixed(1);
        return `${label}(${wr}%/+${sl})`;
      }).join('  ');
      lines.push(`第${k}手局面 → ${items}`);
    }
  }
  return lines.join('\n');
}
