/**
 * joseki build 子命令 — 从 KataGo 棋谱构建定式库
 * @module clients/cli/commands/joseki-build
 *
 * 支持两种模式：
 *   custom — 指定日期范围构建
 *   auto   — 增量构建（三步流程：temp 提取 → CMS 持久化 → 重建）
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CliContext } from '../bootstrap';
import type { CliResult } from '../utils';
import { KatagoArchiveProvider } from '../../../services/game/providers/katago/KatagoArchiveProvider.js';
import { SGFParser } from '../../../domain/sgf/SGFParser.js';
import { CornerExtractor } from '../../../domain/joseki/CornerExtractor.js';
import { JosekiBuilder, type JosekiItem } from '../../../domain/joseki/JosekiBuilder.js';
import { convertToTopRight, normalizeCornerSequence } from '../../../domain/coordinate/CornerConverter.js';
import type { CornerKey } from '../../../domain/coordinate/index.js';
import type { ICornerSequence } from '../../../domain/joseki/ICornerSequence.js';
import type { ISGFNode } from '../../../domain/sgf/types.js';
import { executeAutoBuild } from './joseki-auto.js';

const BUILD_HELP = `
usage: joseki build [options]

从 KataGo 棋谱构建定式库

modes:
  --mode custom     自定义构建（需指定日期范围）
  --mode auto       自动增量构建（从缓存处理新棋谱）

custom mode options:
  --start-date <YYYY-MM-DD>  起始日期（必需）
  --end-date <YYYY-MM-DD>    结束日期（必需）

auto mode options:
  --force-rebuild            强制重建（清除现有状态）
  --limit <N>                限制处理的tar文件数量（测试用）

common options:
  --min-freq <N>             最小频率阈值（默认10）
  --top-k <N>                入库数量上限（默认100000）
  --first-n <N>              提取前N手（默认80）
  --min-moves <N>            最少手数（默认4）
  --max-moves <N>            最多手数（默认50）

examples:
  joseki build --mode custom --start-date 2024-01-01 --end-date 2024-01-31
  joseki build --mode auto
  joseki build --mode auto --force-rebuild --limit 5
`;

interface BuildOptions {
  mode: 'custom' | 'auto';
  startDate?: string;
  endDate?: string;
  minFreq: number;
  topK: number;
  firstN: number;
  minMoves: number;
  maxMoves: number;
  forceRebuild: boolean;
  limit?: number;
}

const HOME = process.env.HOME || '/root';
const WEIQI_JOSEKI_DIR = path.join(HOME, '.weiqi-joseki');
const CACHE_DIR = path.join(WEIQI_JOSEKI_DIR, 'katago-cache');
const DB_PATH = path.join(WEIQI_JOSEKI_DIR, 'database.json');

const CORNERS: CornerKey[] = ['tl', 'tr', 'bl', 'br'];
const VALID_FIRST_MOVES = new Set([
  'pd', 'qc', 'pc', 'oe', 'oc', 'nc', 'od', 'nd', 'ne', 'me',
]);

/** 检查指定角的9路范围内是否有棋子 */
const CORNER_9LU_RANGES: Record<string, [number, number, number, number]> = {
  tl: [0, 8, 0, 8],
  tr: [10, 18, 0, 8],
  bl: [0, 8, 10, 18],
  br: [10, 18, 10, 18],
};
function hasStoneInCorner9lu(coords: string[], cornerKey: string): boolean {
  const range = CORNER_9LU_RANGES[cornerKey];
  if (!range) return false;
  const [cmin, cmax, rmin, rmax] = range;
  for (const c of coords) {
    if (!c || c === 'tt' || c === 'pass' || c.length !== 2) continue;
    const col = c.charCodeAt(0) - 97;
    const row = c.charCodeAt(1) - 97;
    if (col >= cmin && col <= cmax && row >= rmin && row <= rmax) return true;
  }
  return false;
}

/** 从主分支提取带胜率的着法 */
interface MoveWithWinrate {
  color: string;
  coord: string;
  blackWr?: number;
  whiteWr?: number;
}

function extractMainBranchWithWinrate(root: ISGFNode, firstN: number): MoveWithWinrate[] {
  const moves: MoveWithWinrate[] = [];
  let node: ISGFNode | undefined = root;
  while (node && node.children.length > 0 && moves.length < firstN) {
    node = node.children[0];
    if (node && node.color) {
      const coord = node.coord || 'tt';
      let blackWr: number | undefined;
      let whiteWr: number | undefined;
      const cProp = node.properties['C'];
      if (cProp !== undefined) {
        const comment = Array.isArray(cProp) ? (cProp[0] ?? '') : String(cProp);
        const m = comment.match(/^(\d+\.?\d*)\s+(\d+\.?\d*)/);
        if (m && m[1] && m[2]) {
          blackWr = parseFloat(m[1]);
          whiteWr = parseFloat(m[2]);
        }
      }
      moves.push({ color: node.color, coord, blackWr, whiteWr });
    }
  }
  return moves;
}

interface JosekiDB {
  version: string;
  createdAt: string;
  updatedAt: string;
  total: number;
  sequences_used: number;
  joseki: JosekiItem[];
}

/** 从 tar 提取 SGF（跨平台纯 TS） */
function extractSgfFromTar(tarPath: string): string[] {
  try {
    const data = fs.readFileSync(tarPath);
    const entries = KatagoArchiveProvider.extractSgfFromTarBz2(new Uint8Array(data));
    return entries.map(e => e.sgfContent);
  } catch { return []; }
}

/** 从 SGF 提取四角序列（含胜率） */
function extractSequencesFromSgf(sgfContent: string, firstN: number): { stdCoords: string[]; winrates: number[]; firstColor: string }[] {
  try {
    const parser = new SGFParser();
    const result = parser.parse(sgfContent);
    if (!result.moves || result.moves.length === 0) return [];

    // 从主分支提取带胜率的着法
    const movesWithWr = extractMainBranchWithWinrate(result.tree, firstN);
    if (movesWithWr.length === 0) return [];

    const extractor = new CornerExtractor();
    const rawMoves = movesWithWr.map(m => [m.color, m.coord] as [string, string]);
    const fourCorners = extractor.extractFourCorners(rawMoves, firstN);

    // 建立 (color, coord) → winrate 队列映射（仅含有胜率的着法）
    const coordToWinrates = new Map<string, { blackWr?: number; whiteWr?: number }[]>();
    for (const m of movesWithWr) {
      if (m.blackWr === undefined && m.whiteWr === undefined) continue;
      const key = m.color + '|' + m.coord;
      let list = coordToWinrates.get(key);
      if (!list) { list = []; coordToWinrates.set(key, list); }
      list.push({ blackWr: m.blackWr, whiteWr: m.whiteWr });
    }

    const sequences: { stdCoords: string[]; winrates: number[]; firstColor: string }[] = [];
    for (const ck of CORNERS) {
      const cornerSeq: ICornerSequence | undefined = fourCorners[ck];
      if (!cornerSeq || cornerSeq.moves.length < 4) continue;

      const coords = cornerSeq.moves.map(m => m.coord);
      // 检查该角9路范围内是否有棋子
      if (!hasStoneInCorner9lu(coords, ck)) continue;

      const trMoves = convertToTopRight(coords, ck);
      const { normalized } = normalizeCornerSequence(trMoves);
      if (!normalized || normalized.length < 4) continue;
      if (!VALID_FIRST_MOVES.has(normalized[0]!)) continue;

      const firstColor = cornerSeq.moves[0]?.color ?? 'B';

      // 关联胜率（统一为先手方视角）
      // 对齐 Python: wr 为 None 时用 0.5 并更新 lastWr；tt 用 lastWr
      const winrates: number[] = [];
      let lastWr = 0.5;
      for (const move of cornerSeq.moves) {
        if (move.coord === 'tt' || move.isPass) {
          winrates.push(lastWr);
          continue;
        }
        const key = move.color + '|' + move.coord;
        const wrList = coordToWinrates.get(key);
        const wr = wrList?.shift();
        let wrVal: number;
        if (wr && (wr.blackWr !== undefined || wr.whiteWr !== undefined)) {
          wrVal = firstColor === 'B' ? (wr.blackWr ?? 0.5) : (wr.whiteWr ?? 0.5);
        } else {
          wrVal = 0.5;
        }
        lastWr = wrVal;
        winrates.push(wrVal);
      }

      sequences.push({ stdCoords: normalized, winrates, firstColor });
    }
    return sequences;
  } catch { return []; }
}

function loadOrCreateDb(): JosekiDB {
  if (fs.existsSync(DB_PATH)) {
    try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')); } catch {}
  }
  return { version: '1.0.0', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), total: 0, sequences_used: 0, joseki: [] };
}

function saveDb(db: JosekiDB): void {
  db.updatedAt = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

/** custom 模式 */
function executeCustomBuild(options: BuildOptions): CliResult {
  if (!options.startDate || !options.endDate) {
    return { ok: false, command: 'joseki-build', error: 'custom 模式需要指定 --start-date 和 --end-date' };
  }
  if (!fs.existsSync(CACHE_DIR)) {
    return { ok: false, command: 'joseki-build', error: '缓存目录不存在: ' + CACHE_DIR };
  }

  const allTarFiles = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('rating.tar.bz2')).sort();
  const start = options.startDate.replace(/-/g, '');
  const end = options.endDate.replace(/-/g, '');
  const selectedFiles = allTarFiles.filter(f => {
    const date = f.replace('rating.tar.bz2', '').replace(/-/g, '');
    return date >= start && date <= end;
  });

  if (selectedFiles.length === 0) {
    return { ok: true, command: 'joseki-build', data: { message: '没有符合条件的棋谱文件', totalFiles: allTarFiles.length, selectedFiles: 0 } };
  }

  const builder = new JosekiBuilder({ cmsWidth: 4194304, cmsDepth: 4 });
  let totalGames = 0;
  let totalSequences = 0;

  for (const tarFile of selectedFiles) {
    const tarPath = path.join(CACHE_DIR, tarFile);
    const date = tarFile.replace('rating.tar.bz2', '');
    process.stderr.write('[build] ' + date + '...');

    const sgfContents = extractSgfFromTar(tarPath);
    if (sgfContents.length === 0) { process.stderr.write(' 跳过(空)\n'); continue; }
    totalGames += sgfContents.length;

    for (const sgf of sgfContents) {
      const sequences = extractSequencesFromSgf(sgf, options.firstN);
      totalSequences += sequences.length;
      for (const seq of sequences) {
        builder.addSequence(seq);
      }
    }
    process.stderr.write(' ✅ ' + sgfContents.length + ' 谱\n');
  }

  process.stderr.write('[build] 构建定式库...\n');
  const result = builder.build({
    minFreq: options.minFreq,
    topK: options.topK,
    minMoves: options.minMoves,
    maxMoves: options.maxMoves,
  });

  const db = loadOrCreateDb();
  db.joseki = result;
  db.total = result.length;
  db.sequences_used = totalSequences;
  saveDb(db);

  process.stderr.write('[build] 保存到 ' + DB_PATH + '\n');
  return {
    ok: true,
    command: 'joseki-build',
    data: {
      mode: 'custom',
      totalFiles: allTarFiles.length,
      selectedFiles: selectedFiles.length,
      totalGames,
      totalSequences,
      result: { total: result.length, topJoseki: result.slice(0, 10).map(j => ({ moves: j.moves, frequency: j.frequency })) },
    },
  };
}

export async function runJosekiBuildCommand(args: string[], _ctx: CliContext): Promise<CliResult> {
  if (args.includes('--help') || args.includes('-h')) {
    return { ok: true, command: 'joseki-build-help', data: BUILD_HELP };
  }

  const options: BuildOptions = {
    mode: 'custom',
    minFreq: 10,
    topK: 100000,
    firstN: 80,
    minMoves: 4,
    maxMoves: 50,
    forceRebuild: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--mode' && args[i + 1]) {
      const mode = args[++i];
      if (mode === 'custom' || mode === 'auto') options.mode = mode;
    } else if (arg === '--start-date' && args[i + 1]) {
      options.startDate = args[++i];
    } else if (arg === '--end-date' && args[i + 1]) {
      options.endDate = args[++i];
    } else if (arg === '--min-freq' && args[i + 1]) {
      options.minFreq = parseInt(args[++i], 10);
    } else if (arg === '--top-k' && args[i + 1]) {
      options.topK = parseInt(args[++i], 10);
    } else if (arg === '--first-n' && args[i + 1]) {
      options.firstN = parseInt(args[++i], 10);
    } else if (arg === '--min-moves' && args[i + 1]) {
      options.minMoves = parseInt(args[++i], 10);
    } else if (arg === '--max-moves' && args[i + 1]) {
      options.maxMoves = parseInt(args[++i], 10);
    } else if (arg === '--force-rebuild') {
      options.forceRebuild = true;
    } else if (arg === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[++i], 10);
    }
  }

  if (options.mode === 'auto') {
    try {
      const result = executeAutoBuild(options.forceRebuild, options.limit);
      return {
        ok: true,
        command: 'joseki-build',
        data: {
          mode: 'auto',
          ...result,
          topJoseki: [],
        },
      };
    } catch (e) {
      return { ok: false, command: 'joseki-build', error: e instanceof Error ? e.message : String(e) };
    }
  } else {
    return executeCustomBuild(options);
  }
}
