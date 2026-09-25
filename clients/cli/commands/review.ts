/**
 * review 命令 — 本地棋谱远程 AI 复盘
 * @module clients/cli/commands/review
 *
 * 复用 ReviewService + AIController + CliRemoteKataGoEngine（IAIEngine 远程实现）。
 * 分析逻辑（quick/deep、恶手检测、胜率图、候选选点）全部走 ReviewService，
 * 与 Web 端 review 页面共用同一套代码。
 */

import * as fs from 'fs';
import type { CliContext } from '../bootstrap';
import type { CliResult } from '../utils';
import { CliRemoteKataGoEngine } from '../remote-runtime';
import { AIController } from '../../../services/ai/AIController';
import { ReviewService } from '../../../services/review/ReviewService';
import { SGFParser } from '../../../domain/sgf/SGFParser';
import type { ReviewOptions } from '../../../services/review/types';

const DEFAULT_SIGNALING = 'wss://api.weiqi.lol/ws/signal';
const DEFAULT_PASSWORD = "";

const REVIEW_HELP = `
usage: review <command> [options]

本地棋谱远程 AI 复盘(算力来自远程 KataGo 服务端)

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
    else if (a === '--mode' && args[i + 1]) res.mode = args[i + 1] as 'quick' | 'deep';
    else if (a === '--analyze-move' && args[i + 1]) res.analyzeMoves.push(parseInt(args[++i], 10));
    else if (a === '--format' && args[i + 1]) res.format = args[++i] as 'json' | 'text';
    else if (a === '--debug') res.debug = true;
    else if (!a.startsWith('--') && !res.sgf) res.sgf = a;
  }
  return res;
}

/** 取 SGF:本地文件直接读;URL 用 GameService 下载 */
async function resolveSgf(sgfArg: string, ctx: CliContext): Promise<string> {
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
    const sgf = await resolveSgf(args.sgf, ctx);

    // 1. 创建远程引擎（IAIEngine 实现）
    const engine = new CliRemoteKataGoEngine(args.signaling, args.password, args.debug);
    if (args.debug) console.error('[review] 连接远程服务端...');
    await engine.init();

    // 2. 创建 AIController，注入远程引擎
    const ai = new AIController(engine);

    // 3. 创建 ReviewService，注入 AIController + SGFParser
    const sgfParser = new SGFParser();
    const reviewService = new ReviewService(ai, sgfParser);

    // 4. 加载棋谱
    const reviewId = await reviewService.loadFromSGF(sgf);
    if (args.debug) console.error('[review] 棋谱已加载, reviewId=', reviewId);

    // 5. 分析（复用 ReviewService.analyzeGameBatch）
    const engineInfo = engine.getEngineInfo();
    if (args.debug) console.error('[review] 引擎信息:', JSON.stringify(engineInfo));

    const options: ReviewOptions = {
      visits: args.visits,
      mode: args.mode,
      topK: args.topK,
    };

    const result = await reviewService.analyzeGameBatch(reviewId, options, {
      onProgress: (p) => {
        process.stderr.write(`\r[review] 分析进度 ${p.current ?? 0}/${p.total ?? 0} (${p.percentage ?? 0}%)`);
      },
    });
    process.stderr.write('\n');

    // 6. 整理输出
    const badMoves = reviewService.getBadMoves(reviewId);
    const winrateTrend = reviewService.getWinRateTrend(reviewId);
    const state = reviewService.getState(reviewId);

    const perMove = result.moves.map((m) => ({
      n: m.moveNumber,
      color: m.color,
      bwr: m.winRate,
      sl: m.scoreLead,
      topMoves: (m as any).candidates?.slice(0, args.topK).map((c: any) => ({
        label: coordToLabel(c.x, c.y, state?.boardSize ?? 19),
        winRate: c.winRate,
        scoreLead: c.scoreLead,
        visits: c.visits,
      })) ?? [],
    }));

    // 额外深算指定手
    const deepByMove: Record<number, any> = {};
    for (const mvNum of args.analyzeMoves) {
      if (mvNum < 1 || mvNum > result.moves.length) continue;
      const r = await reviewService.analyzePosition(reviewId, mvNum - 1, {
        visits: args.visits > 0 ? args.visits : 100,
        topK: args.topK,
        includePv: true,
      });
      if (r) {
        deepByMove[mvNum] = r;
      }
    }

    const output: any = {
      gameInfo: state?.gameInfo ?? { black: '?', white: '?', komi: 7.5, result: '' },
      totalMoves: result.totalMoves,
      engineInfo,
      analysis: result.analysis,
      perMove,
      badMoves: badMoves.map(b => ({
        moveNumber: b.moveNumber,
        severity: b.severity,
        winRateChange: b.winRateChange,
        label: coordToLabel(b.x, b.y, state?.boardSize ?? 19),
      })),
      deepByMove,
    };

    engine.disconnect();
    return { ok: true, command: 'review-analyze', data: output };
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
  if (data.analysis) {
    lines.push(`模式: ${data.analysis.mode}  visits: ${data.analysis.visits}  耗时: ${data.analysis.analysisTime?.toFixed(1)}s`);
  }
  lines.push('');
  lines.push(renderWinRateChart(data.perMove));
  if (data.badMoves && data.badMoves.length > 0) {
    lines.push('');
    lines.push(`=== 恶手 (${data.badMoves.length}) ===`);
    for (const b of data.badMoves) {
      const sev = b.severity === 'severe' ? '严重' : b.severity === 'moderate' ? '中等' : '轻微';
      const delta = (b.winRateChange * 100).toFixed(1);
      lines.push(`  #${b.moveNumber} ${b.label} [${sev}] 胜率变化: ${delta}%`);
    }
  }
  lines.push('');
  lines.push('=== 每手 AI 候选选点 ===');
  for (const mv of data.perMove) {
    const top = (mv.topMoves ?? []).slice(0, 5).map((t: any) => `${t.label}(${(t.winRate * 100).toFixed(1)}%/${t.scoreLead.toFixed(1)})`).join('  ');
    lines.push(`#${mv.n} ${mv.color === 'black' ? '黑' : '白'}: ${top}`);
  }
  const deepKeys = Object.keys(data.deepByMove || {});
  if (deepKeys.length > 0) {
    lines.push('');
    lines.push('=== 深算指定局面 ===');
    for (const k of deepKeys) {
      const d = data.deepByMove[k];
      const items = (d.candidates || []).slice(0, 5).map((c: any) => `${coordToLabel(c.x, c.y, 19)}(${(c.winRate * 100).toFixed(1)}%/${c.scoreLead.toFixed(1)})`).join('  ');
      lines.push(`第${k}手局面 → ${items}`);
    }
  }
  return lines.join('\n');
}
