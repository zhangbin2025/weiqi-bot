/**
 * joseki auto 构建逻辑 — 对齐 Python 版三步流程
 * @module clients/cli/commands/joseki-auto
 *
 * 流程：
 *   1. 提取: tar → SGF → 四角着法 → temp/YYYY-MM-DD.txt.gz
 *   2. CMS 持久化: 每30天保存 cms.json
 *   3. 重建: 读取所有 temp + CMS → 构建定式库
 *
 * 目录结构（与 Python 版一致）：
 *   ~/.weiqi-joseki/
 *   ├── katago-cache/          # tar 文件缓存
 *   ├── auto/
 *   │   ├── state.json         # 配置
 *   │   ├── cms.json           # CMS 持久化
 *   │   └── temp/              # 每日提取的中间文件
 *   │       └── YYYY-MM-DD.txt.gz
 *   └── database.json          # 定式数据库
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { KatagoArchiveProvider } from '../../../services/game/providers/katago/KatagoArchiveProvider.js';
import { KatagoArchiveProvider as KAProvider } from '../../../services/game/providers/katago/KatagoArchiveProvider.js';
import type { KatagoSgfEntry } from '../../../services/game/providers/katago/types.js';
import { SGFParser } from '../../../domain/sgf/SGFParser.js';
import { CornerExtractor } from '../../../domain/joseki/CornerExtractor.js';
import { JosekiBuilder, type JosekiItem, type TempLine } from '../../../domain/joseki/JosekiBuilder.js';
import { JosekiBuildService } from '../../../services/joseki/JosekiBuildService.js';
import { CountMinSketch } from '../../../utils/CMS.js';
import { convertToTopRight, normalizeCornerSequence } from '../../../domain/coordinate/CornerConverter.js';
import type { CornerKey } from '../../../domain/coordinate/index.js';
import type { ICornerSequence } from '../../../domain/joseki/ICornerSequence.js';

const HOME = process.env.HOME || '/root';
const WEIQI_JOSEKI_DIR = path.join(HOME, '.weiqi-joseki');
const CACHE_DIR = path.join(WEIQI_JOSEKI_DIR, 'katago-cache');
const AUTO_DIR = path.join(WEIQI_JOSEKI_DIR, 'auto');
const TEMP_DIR = path.join(AUTO_DIR, 'temp');
const CMS_PATH = path.join(AUTO_DIR, 'cms.json');
const STATE_PATH = path.join(AUTO_DIR, 'state.json');
const DB_PATH = path.join(WEIQI_JOSEKI_DIR, 'database.json');

const CORNERS: CornerKey[] = ['tl', 'tr', 'bl', 'br'];
const BATCH_SIZE = 30;

interface AutoConfig {
  cms_width: number;
  cms_depth: number;
  first_n: number;
  min_freq: number;
  min_moves: number;
  max_moves: number;
  global_top_k: number;
}

interface StateData {
  mode: string;
  config: AutoConfig;
}

/** 自适应 CMS 配置 */
function getAdaptiveCmsConfig(estimatedGames: number): { width: number; depth: number } {
  if (estimatedGames < 100_000) return { width: 1_048_576, depth: 4 };
  if (estimatedGames < 1_000_000) return { width: 4_194_304, depth: 4 };
  return { width: 16_777_216, depth: 4 };
}

/** 初始化 state.json */
function initState(forceRebuild: boolean): StateData {
  if (forceRebuild) {
    if (fs.existsSync(AUTO_DIR)) {
      try { fs.rmSync(AUTO_DIR, { recursive: true, force: true }); } catch {}
    }
  }
  if (!fs.existsSync(AUTO_DIR)) fs.mkdirSync(AUTO_DIR, { recursive: true });
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

  if (fs.existsSync(STATE_PATH)) {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')); } catch {}
  }

  const cmsConfig = getAdaptiveCmsConfig(2_000_000);
  const state: StateData = {
    mode: 'auto',
    config: {
      cms_width: cmsConfig.width,
      cms_depth: cmsConfig.depth,
      first_n: 80,
      min_freq: 10,
      min_moves: 4,
      max_moves: 50,
      global_top_k: 100_000,
    },
  };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  return state;
}

/** 从 tar 文件提取 SGF（跨平台，纯 TS） */
function extractSgfFromTar(tarPath: string): string[] {
  try {
    const data = fs.readFileSync(tarPath);
    const entries = KatagoArchiveProvider.extractSgfFromTarBz2(new Uint8Array(data));
    return entries.map(e => e.sgfContent);
  } catch { return []; }
}

/** 从 SGF 提取四角序列并归一化，写入 temp 行 */
function extractTempLines(sgfContent: string, firstN: number): string[] {
  try {
    const parser = new SGFParser();
    const result = parser.parse(sgfContent);
    if (!result.moves || result.moves.length === 0) return [];

    const extractor = new CornerExtractor();
    const rawMoves = result.moves.map(m => [m.color, m.coord] as [string, string]);
    const fourCorners = extractor.extractFourCorners(rawMoves, firstN);

    const lines: string[] = [];
    for (const ck of CORNERS) {
      const cornerSeq: ICornerSequence | undefined = fourCorners[ck];
      if (!cornerSeq || cornerSeq.moves.length < 4) continue;

      const coords = cornerSeq.moves.map(m => m.coord);
      const trMoves = convertToTopRight(coords, ck);
      const { normalized } = normalizeCornerSequence(trMoves);
      if (!normalized || normalized.length < 4) continue;
      if (!VALID_FIRST_MOVES.has(normalized[0]!)) continue;

      const firstColor = cornerSeq.moves[0]?.color ?? 'B';
      const winrates = new Array(cornerSeq.moves.length).fill(0.5);

      const line = JosekiBuildService.toTempLine({
        stdCoords: normalized,
        winrates,
        firstColor,
      });
      lines.push(line);
    }
    return lines;
  } catch { return []; }
}

const VALID_FIRST_MOVES = new Set([
  'pd', 'qc', 'pc', 'oe', 'oc', 'nc', 'od', 'nd', 'ne', 'me',
]);

/** gzip 写入 */
function gzipWriteSync(filePath: string, text: string): void {
  const compressed = zlib.gzipSync(text, { encoding: 'utf-8' });
  fs.writeFileSync(filePath, compressed);
}

/** gzip 读取 */
function gzipReadSync(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return zlib.gunzipSync(data).toString('utf-8');
}

interface JosekiDB {
  version: string;
  createdAt: string;
  updatedAt: string;
  total: number;
  sequences_used: number;
  joseki: JosekiItem[];
}

function loadOrCreateDb(): JosekiDB {
  if (fs.existsSync(DB_PATH)) {
    try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')); } catch {}
  }
  return {
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    total: 0,
    sequences_used: 0,
    joseki: [],
  };
}

function saveDb(db: JosekiDB): void {
  db.updatedAt = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

export interface AutoBuildResult {
  totalFiles: number;
  processedFiles: number;
  totalGames: number;
  totalSequences: number;
  josekiCount: number;
}

/** 执行 auto 模式三步流程 */
export function executeAutoBuild(
  forceRebuild: boolean,
  limit?: number
): AutoBuildResult {
  const state = initState(forceRebuild);
  const cfg = state.config;

  process.stderr.write('[auto] CMS配置: width=' + cfg.cms_width + ', depth=' + cfg.cms_depth + '\n');

  if (!fs.existsSync(CACHE_DIR)) {
    throw new Error('缓存目录不存在: ' + CACHE_DIR + '\n请先下载 KataGo 棋谱');
  }

  const allTarFiles = fs.readdirSync(CACHE_DIR)
    .filter(f => f.endsWith('rating.tar.bz2'))
    .sort();

  if (allTarFiles.length === 0) {
    throw new Error('缓存目录中没有棋谱文件');
  }

  // 步骤1: 提取 tar → temp 文件（跳过已存在的）
  process.stderr.write('\n[auto] 步骤1/3: 提取棋谱到 temp 文件...\n');

  // 加载或创建 CMS
  let cms: CountMinSketch;
  if (fs.existsSync(CMS_PATH)) {
    const cmsData = JSON.parse(fs.readFileSync(CMS_PATH, 'utf-8'));
    cms = CountMinSketch.fromJSON(cmsData);
    process.stderr.write('[auto] 加载已有 CMS\n');
  } else {
    cms = new CountMinSketch(cfg.cms_width, cfg.cms_depth);
    process.stderr.write('[auto] 创建新 CMS\n');
  }

  let processedCount = 0;
  let totalGames = 0;
  let totalSequences = 0;
  let batchCount = 0;
  let lastProcessedDate = '';

  let filesToProcess = allTarFiles;
  if (limit) {
    filesToProcess = allTarFiles.slice(0, limit);
    process.stderr.write('[auto] 测试模式：限制处理 ' + limit + ' 个文件\n');
  }

  for (const tarFile of filesToProcess) {
    const date = tarFile.replace('rating.tar.bz2', '');
    const tempPath = path.join(TEMP_DIR, date + '.txt.gz');

    // 断点恢复：temp 已存在则跳过
    if (fs.existsSync(tempPath) && fs.statSync(tempPath).size > 100) {
      continue;
    }

    const tarPath = path.join(CACHE_DIR, tarFile);
    const sgfContents = extractSgfFromTar(tarPath);
    if (sgfContents.length === 0) continue;

    const tempLines: string[] = [];
    for (const sgf of sgfContents) {
      const lines = extractTempLines(sgf, cfg.first_n);
      tempLines.push(...lines);
      // 同时更新 CMS
      for (const line of lines) {
        const tempData = JosekiBuildService.parseTempLine(line);
        if (tempData) {
          for (let len = 2; len <= tempData.coords.length; len++) {
            cms.update(tempData.coords.slice(0, len).join(' '), 1);
          }
          totalSequences++;
        }
      }
    }

    if (tempLines.length === 0) continue;

    gzipWriteSync(tempPath, tempLines.join('\n') + '\n');
    totalGames += sgfContents.length;
    processedCount++;
    lastProcessedDate = date;

    process.stderr.write('  ' + date + ': ' + sgfContents.length + ' 谱, ' + tempLines.length + ' 序列\n');

    // 每30天保存一次 CMS
    if (processedCount % BATCH_SIZE === 0) {
      fs.writeFileSync(CMS_PATH, JSON.stringify(cms.toJSON()), 'utf-8');
      batchCount++;
      process.stderr.write('  💾 批次 ' + batchCount + ' CMS 保存完成\n');
    }
  }

  // 最终保存 CMS
  if (processedCount > 0) {
    fs.writeFileSync(CMS_PATH, JSON.stringify(cms.toJSON()), 'utf-8');
    process.stderr.write('[auto] CMS 保存完成（' + processedCount + ' 个新文件）\n');
  } else {
    process.stderr.write('[auto] 没有新文件需要处理\n');
  }

  // 步骤2: 读取所有 temp 文件
  process.stderr.write('\n[auto] 步骤2/3: 读取 temp 文件...\n');
  const tempFiles = fs.readdirSync(TEMP_DIR)
    .filter(f => f.endsWith('.txt.gz'))
    .sort();

  process.stderr.write('[auto] 共 ' + tempFiles.length + ' 个 temp 文件\n');

  const allTempLines: TempLine[] = [];
  let tempSequences = 0;
  for (const tf of tempFiles) {
    const content = gzipReadSync(path.join(TEMP_DIR, tf));
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      const parsed = JosekiBuildService.parseTempLine(line);
      if (parsed) {
        allTempLines.push(parsed);
        tempSequences++;
      }
    }
  }
  process.stderr.write('[auto] 共 ' + tempSequences + ' 条序列\n');

  // 步骤3: 重建定式库
  process.stderr.write('\n[auto] 步骤3/3: 重建定式库...\n');
  const builder = new JosekiBuilder({ cmsWidth: cfg.cms_width, cmsDepth: cfg.cms_depth });
  builder.setCMS(cms);

  const josekiList = builder.buildFromTempData(
    allTempLines,
    cms,
    {
      minFreq: cfg.min_freq,
      topK: cfg.global_top_k,
      minMoves: cfg.min_moves,
      maxMoves: cfg.max_moves,
    },
    tempSequences
  );

  const db = loadOrCreateDb();
  db.joseki = josekiList;
  db.total = josekiList.length;
  db.sequences_used = tempSequences;
  saveDb(db);

  process.stderr.write('[auto] 保存到 ' + DB_PATH + '\n');
  process.stderr.write('[auto] 完成！共 ' + josekiList.length + ' 条定式\n');

  return {
    totalFiles: allTarFiles.length,
    processedFiles: processedCount,
    totalGames,
    totalSequences,
    josekiCount: josekiList.length,
  };
}
