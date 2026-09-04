/**
 * joseki build 子命令 — 从 KataGo 构建定式库（完整实现，支持增量）
 * @module clients/cli/commands/joseki-build
 * 
 * 目录结构（对齐 Python 版本）：
 * ~/.weiqi-joseki/
 * ├── katago-cache/        # tar 文件缓存
 * ├── auto/                # 状态目录
 * │   ├── state.json      # 配置
 * │   └── cms.json        # 最后处理日期
 * └── joseki.json         # 定式数据库
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type { CliContext } from '../bootstrap';
import type { CliResult } from '../utils';
import { JosekiBuilder } from '../../../domain/joseki/JosekiBuilder.js';
import { SGFParser } from '../../../domain/sgf/SGFParser.js';
import { CornerExtractor } from '../../../domain/joseki/CornerExtractor.js';

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
  --output <PATH>            数据库路径（默认 ~/.weiqi-joseki/joseki.json）

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
  outputPath: string;
}

const WEIQI_JOSEKI_DIR = path.join(process.env.HOME || '/root', '.weiqi-joseki');
const CACHE_DIR = path.join(WEIQI_JOSEKI_DIR, 'katago-cache');
const AUTO_DIR = path.join(WEIQI_JOSEKI_DIR, 'auto');

interface JosekiDB {
  version: string;
  createdAt: string;
  updatedAt: string;
  total: number;
  sequences_used: number;
  joseki: any[];
}

function extractSgfFromTarBz2(tarPath: string): string[] {
  try {
    const cmd = 'tar -tjf "' + tarPath + '" 2>/dev/null | head -100';
    const fileList = execSync(cmd, { encoding: 'utf-8' }).trim().split('\n');
    const tmpDir = '/tmp/katago-sgf-' + Date.now();
    fs.mkdirSync(tmpDir, { recursive: true });
    execSync('tar -xjf "' + tarPath + '" -C "' + tmpDir + '"', { stdio: 'pipe' });
    const sgfContents: string[] = [];
    for (const file of fileList) {
      if (file.endsWith('.sgf')) {
        const sgfPath = path.join(tmpDir, file);
        if (fs.existsSync(sgfPath)) {
          try {
            sgfContents.push(fs.readFileSync(sgfPath, 'utf-8'));
          } catch {}
        }
      }
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    return sgfContents;
  } catch { return []; }
}

function extractSequencesFromSgf(sgfContent: string, firstN: number): any[] {
  try {
    const parser = new SGFParser();
    const result = parser.parse(sgfContent);
    if (!result.moves || result.moves.length === 0) return [];
    const extractor = new CornerExtractor();
    const rawMoves = result.moves.map(m => [m.color, m.coord] as [string, string]);
    const fourCorners = extractor.extractFourCorners(rawMoves, firstN);
    const sequences: any[] = [];
    for (const cornerSeq of Object.values(fourCorners)) {
      if (cornerSeq && (cornerSeq as any).moves && (cornerSeq as any).moves.length >= 4) {
        sequences.push({
          moves: (cornerSeq as any).moves.map((m: any) => m.coord),
          winrates: new Array((cornerSeq as any).moves.length).fill(0.5),
        });
      }
    }
    return sequences;
  } catch { return []; }
}

function loadOrCreateDb(dbPath: string): JosekiDB {
  if (fs.existsSync(dbPath)) {
    try { return JSON.parse(fs.readFileSync(dbPath, 'utf-8')); } catch {}
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

function saveDb(dbPath: string, db: JosekiDB): void {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db.updatedAt = new Date().toISOString();
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');
}

async function executeAutoBuild(options: BuildOptions, ctx: CliContext): Promise<CliResult> {
  // 强制重建
  if (options.forceRebuild) {
    process.stderr.write('[build] 强制重建，清除现有状态...\n');
    if (fs.existsSync(AUTO_DIR)) {
      try { fs.rmSync(AUTO_DIR, { recursive: true, force: true }); } catch {}
    }
    if (fs.existsSync(options.outputPath)) {
      try { fs.unlinkSync(options.outputPath); } catch {}
    }
  }

  // 确保目录存在
  if (!fs.existsSync(CACHE_DIR)) {
    return {
      ok: false,
      command: 'joseki-build',
      error: '缓存目录不存在: ' + CACHE_DIR + '\n请先下载 KataGo 棋谱',
    };
  }

  if (!fs.existsSync(AUTO_DIR)) {
    fs.mkdirSync(AUTO_DIR, { recursive: true });
  }

  // 查找所有 tar 文件（按日期升序）
  const allTarFiles = fs.readdirSync(CACHE_DIR)
    .filter(f => f.endsWith('rating.tar.bz2'))
    .sort();

  if (allTarFiles.length === 0) {
    return {
      ok: false,
      command: 'joseki-build',
      error: '缓存目录中没有棋谱文件',
    };
  }

  // 检查断点
  const cmsPath = path.join(AUTO_DIR, 'cms.json');
  let lastProcessedDate: string | null = null;
  
  if (fs.existsSync(cmsPath)) {
    try {
      const cmsData = JSON.parse(fs.readFileSync(cmsPath, 'utf-8'));
      lastProcessedDate = cmsData.lastDate;
      process.stderr.write('[build] 断点恢复：最后处理到 ' + lastProcessedDate + '\n');
    } catch {}
  } else {
    process.stderr.write('[build] 全新构建\n');
  }

  // 过滤新文件
  let filesToProcess = allTarFiles;
  if (lastProcessedDate) {
    filesToProcess = allTarFiles.filter(f => {
      const date = f.replace('rating.tar.bz2', '');
      return date > lastProcessedDate!;
    });
  }
  
  if (options.limit) {
    filesToProcess = filesToProcess.slice(0, options.limit);
  }

  if (filesToProcess.length === 0) {
    process.stderr.write('[build] 没有新棋谱需要处理\n');
    return {
      ok: true,
      command: 'joseki-build',
      data: {
        message: '没有新棋谱需要处理',
        totalFiles: allTarFiles.length,
        processedFiles: 0,
      },
    };
  }

  process.stderr.write('[build] 需要处理 ' + filesToProcess.length + ' 个新文件\n');

  const db = loadOrCreateDb(options.outputPath);
  const builder = new JosekiBuilder({ cmsWidth: 10000, cmsDepth: 5 });

  let totalGames = 0;
  let totalSequences = 0;
  const processedDates: string[] = [];

  for (const tarFile of filesToProcess) {
    const tarPath = path.join(CACHE_DIR, tarFile);
    const date = tarFile.replace('rating.tar.bz2', '');
    
    process.stderr.write('[build] 处理 ' + date + '...\n');
    
    const sgfContents = extractSgfFromTarBz2(tarPath);
    totalGames += sgfContents.length;
    
    for (const sgf of sgfContents) {
      const sequences = extractSequencesFromSgf(sgf, options.firstN);
      totalSequences += sequences.length;
      for (const seq of sequences) {
        builder.addSequence({
          stdCoords: seq.moves,
          winrates: seq.winrates,
          firstColor: 'B',
          direction: 'ruld',
        });
      }
    }
    
    processedDates.push(date);
    
    // 批量保存
    if (processedDates.length % 30 === 0) {
      process.stderr.write('[build] 批量保存（每30天）...\n');
      fs.writeFileSync(cmsPath, JSON.stringify({ lastDate: date }), 'utf-8');
      const result = builder.build({
        minFreq: options.minFreq,
        topK: options.topK,
        minMoves: options.minMoves,
        maxMoves: options.maxMoves,
      });
      db.joseki = result;
      db.total = result.length;
      saveDb(options.outputPath, db);
    }
    
    process.stderr.write('  ✅ ' + sgfContents.length + ' 谱, ' + totalSequences + ' 序列\n');
  }

  process.stderr.write('[build] 构建定式库...\n');
  const finalResult = builder.build({
    minFreq: options.minFreq,
    topK: options.topK,
    minMoves: options.minMoves,
    maxMoves: options.maxMoves,
  });

  db.joseki = finalResult;
  db.total = finalResult.length;
  db.sequences_used = builder.getStats().sequenceCount;
  saveDb(options.outputPath, db);
  
  fs.writeFileSync(cmsPath, JSON.stringify({ lastDate: processedDates[processedDates.length - 1] }), 'utf-8');
  
  process.stderr.write('[build] 保存到 ' + options.outputPath + '\n');

  return {
    ok: true,
    command: 'joseki-build',
    data: {
      mode: 'auto',
      totalFiles: allTarFiles.length,
      processedFiles: filesToProcess.length,
      totalGames,
      totalSequences,
      result: {
        total: finalResult.length,
        topJoseki: finalResult.slice(0, 10).map(j => ({
          moves: j.moves,
          frequency: j.frequency,
        })),
      },
    },
  };
}

async function executeCustomBuild(options: BuildOptions, ctx: CliContext): Promise<CliResult> {
  if (!options.startDate || !options.endDate) {
    return {
      ok: false,
      command: 'joseki-build',
      error: 'custom 模式需要指定 --start-date 和 --end-date',
    };
  }

  if (!fs.existsSync(CACHE_DIR)) {
    return {
      ok: false,
      command: 'joseki-build',
      error: '缓存目录不存在: ' + CACHE_DIR,
    };
  }

  const allTarFiles = fs.readdirSync(CACHE_DIR)
    .filter(f => f.endsWith('rating.tar.bz2'))
    .sort();

  const start = options.startDate.replace(/-/g, '');
  const end = options.endDate.replace(/-/g, '');
  
  const selectedFiles = allTarFiles.filter(f => {
    const date = f.replace('rating.tar.bz2', '').replace(/-/g, '');
    return date >= start && date <= end;
  });

  if (selectedFiles.length === 0) {
    return {
      ok: true,
      command: 'joseki-build',
      data: {
        message: '没有符合条件的棋谱文件',
        totalFiles: allTarFiles.length,
        selectedFiles: 0,
      },
    };
  }

  const builder = new JosekiBuilder({ cmsWidth: 10000, cmsDepth: 5 });
  let totalGames = 0;
  let totalSequences = 0;

  for (const tarFile of selectedFiles) {
    const tarPath = path.join(CACHE_DIR, tarFile);
    const date = tarFile.replace('rating.tar.bz2', '');
    
    process.stderr.write('[build] 处理 ' + date + '...\n');
    
    const sgfContents = extractSgfFromTarBz2(tarPath);
    totalGames += sgfContents.length;
    
    for (const sgf of sgfContents) {
      const sequences = extractSequencesFromSgf(sgf, options.firstN);
      totalSequences += sequences.length;
      for (const seq of sequences) {
        builder.addSequence({
          stdCoords: seq.moves,
          winrates: seq.winrates,
          firstColor: 'B',
          direction: 'ruld',
        });
      }
    }
    
    process.stderr.write('  ✅ ' + sgfContents.length + ' 谱, ' + totalSequences + ' 序列\n');
  }

  process.stderr.write('[build] 构建定式库...\n');
  const result = builder.build({
    minFreq: options.minFreq,
    topK: options.topK,
    minMoves: options.minMoves,
    maxMoves: options.maxMoves,
  });

  const db = loadOrCreateDb(options.outputPath);
  db.joseki = result;
  db.total = result.length;
  db.sequences_used = builder.getStats().sequenceCount;
  saveDb(options.outputPath, db);
  
  process.stderr.write('[build] 保存到 ' + options.outputPath + '\n');

  return {
    ok: true,
    command: 'joseki-build',
    data: {
      mode: 'custom',
      totalFiles: allTarFiles.length,
      selectedFiles: selectedFiles.length,
      totalGames,
      totalSequences,
      result: {
        total: result.length,
        topJoseki: result.slice(0, 10).map(j => ({
          moves: j.moves,
          frequency: j.frequency,
        })),
      },
    },
  };
}

export async function runJosekiBuildCommand(args: string[], ctx: CliContext): Promise<CliResult> {
  if (args.includes('--help') || args.includes('-h')) {
    return { ok: true, command: 'joseki-build-help', data: BUILD_HELP };
  }

  const defaultOutputPath = path.join(WEIQI_JOSEKI_DIR, 'joseki.json');

  const options: BuildOptions = {
    mode: 'custom',
    minFreq: 10,
    topK: 100000,
    firstN: 80,
    minMoves: 4,
    maxMoves: 50,
    forceRebuild: false,
    outputPath: defaultOutputPath,
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
    } else if (arg === '--output' && args[i + 1]) {
      options.outputPath = args[++i];
    }
  }

  if (options.mode === 'auto') {
    return executeAutoBuild(options, ctx);
  } else {
    return executeCustomBuild(options, ctx);
  }
}
