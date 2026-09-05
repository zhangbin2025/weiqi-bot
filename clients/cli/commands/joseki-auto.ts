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
import type { ISGFNode } from '../../../domain/sgf/types.js';

const HOME = process.env.HOME || '/root';
const WEIQI_JOSEKI_DIR = path.join(HOME, '.weiqi-joseki');
const CACHE_DIR = path.join(WEIQI_JOSEKI_DIR, 'katago-cache');
const AUTO_DIR = path.join(WEIQI_JOSEKI_DIR, 'auto');
const TEMP_DIR = path.join(AUTO_DIR, 'temp');
const CMS_PATH = path.join(AUTO_DIR, 'cms.bin');
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

/** 从主分支提取带胜率的着法（对齐 Python extract_main_branch_with_winrate） */
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
      // 从 C 属性解析胜率
      let blackWr: number | undefined;
      let whiteWr: number | undefined;
      const cProp = node.properties['C'];
      if (cProp !== undefined) {
        const comment = Array.isArray(cProp) ? (cProp[0] ?? '') : String(cProp);
        // KataGo Archive 格式: "0.51 0.49 0.00 0.6 v=600"
        const parts = comment.trim().split(/\s+/);
        if (parts.length >= 5) {
          blackWr = parseFloat(parts[0]);
          whiteWr = parseFloat(parts[1]);
          if (isNaN(blackWr) || isNaN(whiteWr)) {
            blackWr = undefined;
            whiteWr = undefined;
          }
        }
      }
      moves.push({ color: node.color, coord, blackWr, whiteWr });
    }
  }
  return moves;
}

/** 从 tar 文件提取 SGF（跨平台，纯 TS） */
function extractSgfFromTar(tarPath: string): string[] {
  try {
    const data = fs.readFileSync(tarPath);
    const entries = KatagoArchiveProvider.extractSgfFromTarBz2(new Uint8Array(data));
    return entries.map(e => e.sgfContent);
  } catch { return []; }
}

/** 从 SGF 提取四角序列并归一化，写入 temp 行（含胜率） */
function extractTempLines(sgfContent: string, firstN: number): string[] {
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

    const seenSequences = new Set<string>();
    const lines: string[] = [];
    for (const ck of CORNERS) {
      const cornerSeq: ICornerSequence | undefined = fourCorners[ck];
      if (!cornerSeq || cornerSeq.moves.length < 4) continue;

      const coords = cornerSeq.moves.map(m => m.coord);
      // 检查该角9路范围内是否有棋子（对齐 Python has_stone_in_corner_9lu）
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
          // 脱先：用前一手的胜率
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
          // 胜率数据不存在：用默认值 0.5
          wrVal = 0.5;
        }
        lastWr = wrVal; // 无论是否找到，都更新 lastWr
        winrates.push(wrVal);
      }

      const line = JosekiBuildService.toTempLine({
        stdCoords: normalized,
        winrates,
        firstColor,
      });
      // 同一 SGF 内去重（按坐标序列，对齐 Python seen_sequences）
      const seqKey = normalized.join(' ');
      if (seenSequences.has(seqKey)) continue;
      seenSequences.add(seqKey);
      lines.push(line);
    }
    return lines;
  } catch { return []; }
}

const VALID_FIRST_MOVES = new Set([
  'pd', 'qc', 'pc', 'oe', 'oc', 'nc', 'od', 'nd', 'ne', 'me',
]);

/** 检查指定角的9路范围内是否有棋子（对齐 Python has_stone_in_corner_9lu） */
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
  joseki_list: JosekiItem[];
  last_updated: string;
}

function loadOrCreateDb(): JosekiDB {
  if (fs.existsSync(DB_PATH)) {
    try {
      const data = fs.readFileSync(DB_PATH);
      let jsonStr: string;
      try {
        jsonStr = zlib.gunzipSync(data).toString('utf-8');
      } catch {
        jsonStr = data.toString('utf-8');
      }
      const parsed = JSON.parse(jsonStr);
      // 迁移旧格式：只保留 Python 版字段
      const db: JosekiDB = {
        version: '2.0.0',
        joseki_list: parsed.joseki_list ?? parsed.joseki ?? [],
        last_updated: parsed.last_updated ?? parsed.updatedAt ?? new Date().toISOString(),
      };
      return db;
    } catch {}
  }
  return {
    version: '2.0.0',
    joseki_list: [],
    last_updated: new Date().toISOString(),
  };
}

function saveDb(db: JosekiDB): void {
  db.last_updated = new Date().toISOString();
  // 与 Python 一致：gzip 压缩存储
  const jsonStr = JSON.stringify(db, null, 2);
  const compressed = zlib.gzipSync(jsonStr, { encoding: 'utf-8' });
  fs.writeFileSync(DB_PATH, compressed);
}

/** 流式迭代 temp 文件（对齐 Python _iter_temp_files）
 *
 * 逐文件读取、逐行解析，不将所有数据加载到内存。
 * 每次只持有当前文件的内容，避免 OOM。
 */
function* iterTempLines(tempDir: string): Iterable<TempLine> {
  const tempFiles = fs.readdirSync(tempDir)
    .filter(f => f.endsWith(".txt.gz"))
    .sort();

  for (const tf of tempFiles) {
    const content = gzipReadSync(path.join(tempDir, tf));
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      const parsed = JosekiBuildService.parseTempLine(line);
      if (parsed) yield parsed;
    }
  }
}

export interface AutoBuildResult {
  totalFiles: number;
  processedFiles: number;
  totalGames: number;
  totalSequences: number;
  josekiCount: number;
  sequencesUsed: number;
}

/**
 * 下载缺失的 KataGo 棋谱（对齐 Python download_auto）
 *
 * 1. 抓取 katagoarchive.org index.html → 解析可用日期
 * 2. 对比本地缓存目录 → 找出缺失日期
 * 3. 逐个下载（带重试和延迟）
 */

/** KataGo Archive 基础 URL */
const KATAGO_ARCHIVE_INDEX = 'https://katagoarchive.org/kata1/ratinggames/index.html';
const KATAGO_ARCHIVE_DIR = 'https://katagoarchive.org/kata1/ratinggames/';

/** 从官网 index.html 解析所有可用日期（对齐 Python fetch_available_dates） */
async function fetchAvailableDates(): Promise<string[]> {
  const https = await import('https');

  return new Promise<string[]>((resolve, reject) => {
    const req = https.request(KATAGO_ARCHIVE_INDEX, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://katagoarchive.org/',
        'Connection': 'keep-alive',
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf-8');
        // 匹配 YYYY-MM-DDrating.tar.bz2
        const regex = /(\d{4}-\d{2}-\d{2})rating\.tar\.bz2/g;
        const dates = new Set<string>();
        let match: RegExpExecArray | null;
        while ((match = regex.exec(html)) !== null) {
          dates.add(match[1]!);
        }
        resolve([...dates].sort());
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error('timeout'));
    });
    req.end();
  });
}

/** 下载单个文件（对齐 Python download_single，带重试和延迟） */
function downloadFile(url: string, outputPath: string, maxRetries: number = 3, delaySec: number = 10): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const https = require('https');
    const attempt = (retry: number) => {
      const req = https.request(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Referer': 'https://katagoarchive.org/kata1/ratinggames/',
          'Connection': 'keep-alive',
        },
      }, (res: any) => {
        if (res.statusCode === 404) {
          // 文件不存在，不算错误
          resolve(false);
          return;
        }
        if (res.statusCode !== 200) {
          if (retry < maxRetries) {
            setTimeout(() => attempt(retry + 1), 5000 * (2 ** retry));
            return;
          }
          resolve(false);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          // 检查是否为有效的 bz2 文件（magic bytes: BZh）
          if (buf.length > 1000 && buf[0] === 0x42 && buf[1] === 0x5a && buf[2] === 0x68) {
            fs.writeFileSync(outputPath, buf);
            setTimeout(() => resolve(true), delaySec * 1000);
          } else {
            // 不是有效 tar.bz2（可能是 HTML 错误页面），写空文件标记已尝试
            fs.writeFileSync(outputPath, Buffer.alloc(0));
            resolve(false);
          }
        });
        res.on('error', () => {
          if (retry < maxRetries) {
            setTimeout(() => attempt(retry + 1), 5000 * (2 ** retry));
          } else {
            resolve(false);
          }
        });
      });
      req.on('error', () => {
        if (retry < maxRetries) {
          setTimeout(() => attempt(retry + 1), 5000 * (2 ** retry));
        } else {
          resolve(false);
        }
      });
      req.setTimeout(120000, () => {
        req.destroy();
        if (retry < maxRetries) {
          setTimeout(() => attempt(retry + 1), 5000 * (2 ** retry));
        } else {
          resolve(false);
        }
      });
      req.end();
    };
    attempt(0);
  });
}

/** 自动下载缺失的棋谱（对齐 Python download_auto） */
async function downloadAuto(cacheDir: string, maxRetries: number = 3, delaySec: number = 10): Promise<string[]> {
  process.stderr.write('📋 正在获取可用日期列表...\n');

  let availableDates: string[];
  try {
    availableDates = await fetchAvailableDates();
  } catch (e) {
    process.stderr.write('⚠️  获取可用日期列表失败: ' + (e as Error).message + '\n');
    return [];
  }

  if (availableDates.length === 0) {
    process.stderr.write('⚠️  未获取到可用日期\n');
    return [];
  }

  process.stderr.write('✅ 服务器共有 ' + availableDates.length + ' 个日期的棋谱\n');

  // 对比本地缓存，找出缺失日期
  const pendingDates: string[] = [];
  for (const date of availableDates) {
    const tarPath = path.join(cacheDir, date + 'rating.tar.bz2');
    if (!fs.existsSync(tarPath) || (fs.statSync(tarPath).size > 0 && fs.statSync(tarPath).size < 1000)) {
      pendingDates.push(date);
    }
  }

  if (pendingDates.length === 0) {
    process.stderr.write('✅ 所有可用日期已下载，无需增量下载\n');
    return [];
  }

  process.stderr.write('📥 需要下载 ' + pendingDates.length + ' 个新日期: ' +
    pendingDates[0] + ' ~ ' + pendingDates[pendingDates.length - 1] + '\n');

  const newDownloaded: string[] = [];
  let failed = 0;

  for (let i = 0; i < pendingDates.length; i++) {
    const date = pendingDates[i]!;
    const url = KATAGO_ARCHIVE_DIR + date + 'rating.tar.bz2';
    const outputPath = path.join(cacheDir, date + 'rating.tar.bz2');

    process.stderr.write('  [' + (i + 1) + '/' + pendingDates.length + '] ' + date + '... ');

    const ok = await downloadFile(url, outputPath, maxRetries, delaySec);
    if (ok) {
      newDownloaded.push(date);
      const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
      process.stderr.write('✅ ' + sizeMB + 'MB\n');
    } else {
      failed++;
      process.stderr.write('❌\n');
    }
  }

  process.stderr.write('📊 下载统计: 成功 ' + newDownloaded.length + ', 失败 ' + failed + '\n');
  return newDownloaded;
}

/** 执行 auto 模式三步流程 */
export async function executeAutoBuild(
  forceRebuild: boolean,
  limit?: number
): AutoBuildResult {
  const state = initState(forceRebuild);
  const cfg = state.config;

  process.stderr.write('[auto] CMS配置: width=' + cfg.cms_width + ', depth=' + cfg.cms_depth + '\n');

  if (!fs.existsSync(CACHE_DIR)) {
    throw new Error('缓存目录不存在: ' + CACHE_DIR + '\n请先下载 KataGo 棋谱');
  }

  let allTarFiles = fs.readdirSync(CACHE_DIR)
    .filter(f => f.endsWith('rating.tar.bz2'))
    .sort();

  // 下载缺失的棋谱（对齐 Python download_auto）
  await downloadAuto(CACHE_DIR).catch(e => {
    process.stderr.write('⚠️  下载失败: ' + e + '\n');
  });

  // 重新扫描缓存目录（下载后可能有新文件）
  allTarFiles = fs.readdirSync(CACHE_DIR)
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
    // 二进制格式加载（对齐 Python pickle，零额外内存）
    cms = CountMinSketch.loadFromFile(CMS_PATH);
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
          for (let len = 4; len <= tempData.coords.length; len++) {
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
      cms.saveToFile(CMS_PATH);
      batchCount++;
      process.stderr.write('  💾 批次 ' + batchCount + ' CMS 保存完成\n');
    }
  }

  // 最终保存 CMS
  if (processedCount > 0) {
    cms.saveToFile(CMS_PATH);
    process.stderr.write('[auto] CMS 保存完成（' + processedCount + ' 个新文件）\n');
  } else {
    process.stderr.write('[auto] 没有新文件需要处理\n');
  }

  // 步骤2: 流式读取 temp 文件（对齐 Python _iter_temp_files，避免 OOM）
  process.stderr.write('\n[auto] 步骤2/3: 统计 temp 序列数...\n');
  const tempFiles = fs.readdirSync(TEMP_DIR)
    .filter(f => f.endsWith('.txt.gz'))
    .sort();

  process.stderr.write('[auto] 共 ' + tempFiles.length + ' 个 temp 文件\n');

  // 统计序列总数（一次快速遍历，对齐 Python: sum(1 for _ in self._iter_temp_files)）
  let tempSequences = 0;
  for (const tf of tempFiles) {
    const content = gzipReadSync(path.join(TEMP_DIR, tf));
    for (const line of content.split('\n')) {
      if (line.trim()) tempSequences++;
    }
  }
  process.stderr.write('[auto] 共 ' + tempSequences + ' 条序列\n');

  // 步骤3: 重建定式库（使用生成器流式迭代，不全部加载到内存）
  process.stderr.write('\n[auto] 步骤3/3: 重建定式库...\n');
  const builder = new JosekiBuilder({ cmsWidth: cfg.cms_width, cmsDepth: cfg.cms_depth });
  builder.setCMS(cms);

  const josekiList = builder.buildFromTempData(
    iterTempLines(TEMP_DIR),
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
  db.joseki_list = josekiList;
  // total 和 sequences_used 不再作为顶层字段（与 Python 一致）
  
  saveDb(db);

  process.stderr.write('[auto] 保存到 ' + DB_PATH + '\n');
  process.stderr.write('[auto] 完成！共 ' + josekiList.length + ' 条定式\n');

  return {
    totalFiles: allTarFiles.length,
    processedFiles: processedCount,
    totalGames,
    totalSequences,
    josekiCount: josekiList.length,
    sequencesUsed: Math.floor(tempSequences / 2),
  };
}
