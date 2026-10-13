/**
 * @fileoverview 内置棋谱库归档提供者
 * @description 从本机打包的内置棋谱库（clients/web/shared/assets/data/games）读取分块 .tar.bz2，
 *              按分类加载 SGF（每分类若干块，日期标签为最新日期）。
 *
 * 数据格式：与 KataGo 归档一致，每分类按 <date>.pNNNN.tar.bz2 切块（日期为最新日期），
 *          内含若干 <id>.sgf，块内顺序是全局顺序的一段。
 *          块大小按分类不同（题库 1000/块、棋谱 50/块，见生成脚本 CHUNK_SIZE）。
 * 元数据：<date>.meta.json.gz —— 题库存 pw[]、棋谱存 ids[]，另含 chunkSize / chunks
 * 索引：index.json.gz —— { version, generatedAt, categories: { cat: [dates...] } }
 *
 * URL 协议：
 *   lib://<category>/<date>/<index>   单盘棋谱（index 为该日期下按 id 排序的序号）
 *   lib://<category>                  仅用于源列表（无实际抓取）
 *
 * 隐私：库内棋谱已匿名化（棋手/出题者/AI 名），唯一标识为 md5(id)；
 *       追源请在本机用生成脚本产出的 private-map.json 反查。
 */

import pako from 'pako';
import { Buffer as BufferPolyfill } from 'buffer';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import { BaseProvider } from '../base/BaseProvider';
import type { FetchResult, GameMetadata, PerformanceTiming } from '../base/types';
import type { KatagoSgfEntry } from '../katago/types';
import { parseSGF } from '../../../../domain/sgf';

if (typeof globalThis.Buffer === 'undefined') {
  (globalThis as any).Buffer = BufferPolyfill;
}

// @ts-expect-error - seek-bzip has no type declarations
import * as seekBzipModule from 'seek-bzip';
const _bz2Decompress: (data: Uint8Array) => Uint8Array = (() => {
  const findDecode = (obj: any, depth = 0): ((data: any) => any) | null => {
    if (!obj || depth > 3) return null;
    if (typeof obj.decode === 'function') return obj.decode;
    if (typeof obj.default === 'object' || typeof obj.default === 'function') {
      const found = findDecode(obj.default, depth + 1);
      if (found) return found;
    }
    return null;
  };
  const decodeFn = findDecode(seekBzipModule);
  if (decodeFn) return (d: Uint8Array) => new Uint8Array(decodeFn(d));
  throw new Error('seek-bzip.decode not found');
})();

function decompressBz2(data: Uint8Array): Uint8Array {
  return _bz2Decompress(data);
}

interface TarFile { name: string; size: number; data: Uint8Array; }

function readTarString(buffer: Uint8Array, offset: number, length: number): string {
  let end = offset + length;
  for (let i = offset; i < end; i++) {
    if (buffer[i] === 0) { end = i; break; }
  }
  return new TextDecoder('ascii').decode(buffer.subarray(offset, end)).trim();
}

function parseTar(tarData: Uint8Array): TarFile[] {
  const files: TarFile[] = [];
  let offset = 0;
  while (offset + 512 <= tarData.length) {
    const header = tarData.subarray(offset, offset + 512);
    const name = readTarString(header, 0, 100);
    if (!name || header[0] === 0) break;
    const sizeStr = readTarString(header, 124, 12);
    const size = parseInt(sizeStr, 8) || 0;
    const typeFlag = header[156];
    offset += 512;
    if (typeFlag === 0 || typeFlag === 0x30) {
      if (size > 0 && offset + size <= tarData.length) {
        files.push({ name, size, data: new Uint8Array(tarData.subarray(offset, offset + size)) });
      }
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

/** 本地资源根（与 joseki 数据同目录） */
const DEFAULT_GAMES_BASE = '../shared/assets/data/games';

export interface BuiltinLibraryConfig {
  /** 数据根 URL，默认 ../shared/assets/data/games */
  dataUrl?: string;
  /**
   * 块压缩数据的持久化缓存。注入后已下载的块会留存，刷新页面不必重新下载。
   * 未注入则只保留内存缓存（会话内有效，刷新即失效）。
   */
  chunkStore?: ChunkStore;
}

/** 列表条目（对齐 FetcherApp.fetchLatestGames 的返回结构） */
export interface BuiltinLibraryGameItem {
  source: string;
  title: string;
  subtitle: string;
  date: string;
  url: string;
}

/**
 * 从 SGF 内容中解析题库标签（PW 字段）。
 * 内置题库的 PW 字段形如「类型·难度」，如 死活题·5D、官子题·2D+、中盘题·1K 等。
 * 无难度时仅含类型（如 死活题）。
 */
interface PuzzleTags { type: string; difficulty: string; raw: string; }
/** 从标签原文拆分「类型·难度」（不依赖 SGF 全文，供 meta 索引路径复用） */
function splitPuzzleTags(raw: string): PuzzleTags {
  if (!raw.includes('·')) {
    // 仅类型（无难度分隔符）
    return { type: raw, difficulty: '', raw };
  }
  const [type, difficulty] = raw.split('·').map(s => s.trim());
  return { type: type || '', difficulty: difficulty || '', raw };
}

function parsePuzzleTags(sgfContent: string): PuzzleTags {
  const m = sgfContent.match(/PW\[([^\]]+)\]/);
  const raw = m ? m[1]!.trim() : '';
  return splitPuzzleTags(raw);
}

/**
 * 判断难度是否匹配难度型原子。
 * 难度型原子（如 "5K"、"2D+"）锚定到难度段：
 *   - 大小写不敏感，按确切数字匹配（避免 "5K" 误命中 "15K"）；
 *   - 不带 “+” 的原子（如 "2D"）匹配同数字的同级（2D 与 2D+ 均命中）；
 *   - 带 “+” 的原子（如 "2D+"）仅匹配带 “+” 的同级。
 */
function difficultyMatches(difficulty: string, atom: string): boolean {
  const diff = difficulty.toUpperCase();
  const a = atom.toUpperCase();
  if (!/^\d+[KD]\+?$/.test(a)) return false;
  const m = a.match(/^(\d+)([KD])(\+)?$/);
  if (!m) return false;
  const targetNum = parseInt(m[1]!, 10);
  const targetRank = m[2]!;
  const targetPlus = !!m[3];
  // 解析难度段（可能含多个，如 "2D+ 死活题" 里取 2D+）
  const candidates = diff.match(/\d+[KD]\+?/g);
  if (!candidates) return false;
  return candidates.some(c => {
    const cm = c.match(/^(\d+)([KD])(\+)?$/);
    if (!cm) return false;
    const num = parseInt(cm[1]!, 10);
    const rank = cm[2]!;
    const plus = !!cm[3];
    if (rank !== targetRank || num !== targetNum) return false;
    return targetPlus ? plus : true; // "2D+" 只匹配 2D+；"2D" 匹配 2D 与 2D+
  });
}

/**
 * 判断题库标签是否匹配一个筛选原子（类型或难度）。
 * - 类型原子：对 raw（类型·难度）做大小写不敏感子串匹配。
 * - 难度原子（^⁤\d+[KD]\+?⁤）：走 difficultyMatches 边界匹配。
 */
function atomMatches(tags: PuzzleTags, atom: string): boolean {
  const a = atom.trim().toUpperCase();
  if (!a) return true;
  if (/^\d+[KD]\+?$/.test(a)) return difficultyMatches(tags.difficulty, a);
  return tags.raw.toUpperCase().includes(a);
}

/**
 * 筛选表达式求值：支持括号、and、or，大小写不敏感。
 * 语法：
 *   expr   := term ('or' term)*
 *   term   := factor ('and' factor)*
 *   factor := '(' expr ')' | atom
 * 连续原子之间默认视为 and（兼容单关键字模糊匹配）。
 * 空表达式始终匹配。
 */
function evaluateFilter(expr: string, tags: PuzzleTags): boolean {
  const tokens = expr
    .replace(/\(/g, ' ( ')
    .replace(/\)/g, ' ) ')
    .trim()
    .split(/\s+/)
    .map(t => t.toLowerCase());
  if (tokens.length === 0) return true;

  let pos = 0;
  function peek(): string | undefined { return tokens[pos]; }
  function parseExpr(): boolean {
    let left = parseTerm();
    while (peek() !== undefined && peek() === 'or') {
      pos++;
      const right = parseTerm(); // 必须先解析右侧以推进 pos（避免短路导致的死循环）
      left = left || right;
    }
    return left;
  }
  function parseTerm(): boolean {
    let left = parseFactor();
    while (
      peek() !== undefined &&
      (peek() === 'and' || (peek() !== 'or' && peek() !== ')'))
    ) {
      if (peek() === 'and') pos++;
      const right = parseFactor(); // 必须先解析右侧以推进 pos（避免短路导致的死循环）
      left = left && right;
      if (peek() === 'and') pos++;
    }
    return left;
  }
  function parseFactor(): boolean {
    const t = peek();
    if (t === '(') { pos++; const v = parseExpr(); if (peek() === ')') pos++; return v; }
    if (t === 'and' || t === 'or' || t === undefined || t === ')') return true; // 空因子
    pos++;
    return atomMatches(tags, t);
  }

  const result = parseExpr();
  return result;
}

/** 分块描述（meta.chunks[i]） */
interface BuiltinLibraryChunk {
  /** 该块首条在全局（pw / ids 数组）中的下标 */
  start: number;
  /** 该块条目数 */
  count: number;
  /** 压缩包字节数（仅用于构建期日志/容量预估） */
  size: number;
}

/**
 * 轻量元数据索引（由生成脚本产出 <date>.meta.json.gz，两个分类都生成）。
 * 题库写 pw（标签），棋谱写 ids（md5 文件名）—— 二者二选一，下标均对应
 * 排序后的第 i 个 SGF，即 lib://<cat>/<date>/<i>。
 * 字段均为必填：数据由构建脚本统一产出，不存在旧格式，缺任一字段即视为数据损坏。
 */
interface BuiltinLibraryMeta {
  version: string;
  category: string;
  date: string;
  count: number;
  /** 每块条目数 */
  chunkSize: number;
  /** 块描述数组，覆盖 [0, count) 且无空洞重叠 */
  chunks: BuiltinLibraryChunk[];
  /** 题库：pw[i] 为第 i 条的「类型·难度」标签 */
  pw?: string[];
  /** 棋谱：ids[i] 为第 i 条的 md5 文件名（列表展示用） */
  ids?: string[];
}

/**
 * 块级缓存：内存 Map + 可选持久化后端。
 * 内存缓存解决同一次会话内反复取题；持久化解决「刷新页面又得重新下载」。
 */
/**
 * 块压缩数据的持久化缓存。
 *
 * 键含构建版本（取自 index.json.gz 的 generatedAt）：同一日期重复构建时键会变，
 * 旧内容的块不会被误命中。仅按日期做键不够 —— 同日两次构建（手工 rebuild +
 * cron 又跑一次）产出的块名完全相同，旧块会被当成有效缓存，新数据永远读不到，
 * 只能靠用户手动清浏览器缓存。
 *
 * keys()/delete() 用于回收历史版本留下的块：每次重建都会留下一套新键，
 * 不回收则 IndexedDB 随发布次数线性增长（单套约 6.3MB），写满后 set 静默失败。
 */
interface ChunkStore {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, data: Uint8Array): Promise<void>;
  /** 列出全部缓存键（用于回收）；不可用时返回空数组 */
  keys(): Promise<string[]>;
  /** 删除指定键 */
  delete(key: string): Promise<void>;
}

/**
 * 归档读取器：负责 index.json.gz、.tar.bz2 与 .meta.json.gz 的下载、解压、内存缓存。
 */
export class BuiltinLibraryArchiveProvider {
  private readonly dataUrl: string;
  private indexCache: Record<string, string[]> | null = null;
  /**
   * 构建版本，取自 index.json.gz 的 generatedAt。
   * 作为块/meta 持久化缓存键的一部分，使「同日重复构建」也能正确失效。
   * 未取到索引时为空串（此时键退化为仅含分类/日期，行为同旧版）。
   */
  private buildId: string = '';
  /** 已回收过旧版本缓存的标记：一次会话内只清一次，避免每次取块都扫全表 */
  private prunedForBuildId: string | null = null;
  private metaCache: Map<string, BuiltinLibraryMeta> = new Map();
  /** 已解压块的内存缓存：key = `${category}/${date}/${partIndex}@${buildId}` */
  private chunkCache: Map<string, KatagoSgfEntry[]> = new Map();
  /**
   * 块/meta 原始字节的持久化缓存（可选注入；不注入则只走内存，刷新即失效）。
   * meta 也一并缓存：它体积虽小（72KB）但每次取题都要读，
   * 缓存后刷新页面可完全免网络。
   */
  private readonly chunkStore: ChunkStore | null;

  constructor(
    private readonly network: NetworkManager,
    config?: BuiltinLibraryConfig,
  ) {
    this.dataUrl = (config?.dataUrl ?? DEFAULT_GAMES_BASE).replace(/\/+$/, '');
    this.chunkStore = config?.chunkStore ?? null;
  }

  /**
   * 读取索引，返回 { category: [dates...] }。
   *
   * 索引是唯一的「构建版本」来源（generatedAt 每次重建都会变），且它本身不做持久化
   * 缓存（走 cache:'no-store'，也不写 IndexedDB），所以总能拿到当前发布版本。
   * 取到后顺带回收历史版本遗留的块缓存 —— 见 pruneStaleChunks。
   */
  async loadIndex(force = false): Promise<Record<string, string[]>> {
    if (this.indexCache && !force) return this.indexCache;
    const response = await this.network.request<ArrayBuffer>({
      url: `${this.dataUrl}/index.json.gz`,
      method: 'GET',
      responseType: 'arraybuffer',
    });
    const compressed = new Uint8Array(response.data);
    const isGz = compressed[0] === 0x1f && compressed[1] === 0x8b;
    const text = isGz ? pako.ungzip(compressed, { to: 'string' }) : new TextDecoder().decode(compressed);
    const idx = JSON.parse(text) as { categories?: Record<string, string[]>; generatedAt?: string };
    this.indexCache = idx.categories ?? {};
    // generatedAt 是构建时间戳，唯一标识一次发布；缺失时退化为 ''（键仅含分类/日期）
    this.buildId = typeof idx.generatedAt === 'string' ? idx.generatedAt : '';
    void this.pruneStaleChunks();
    return this.indexCache;
  }

  /**
   * 回收非当前构建版本遗留的块/meta 缓存。
   *
   * 每次重建都会产出一整套新键，旧键不会自动消失。不回收则 IndexedDB 随发布次数
   * 线性增长（单套约 6.3MB：题库 3.4MB + 棋谱 2.9MB），写满后 set() 会静默失败，
   * 表现为「缓存莫名其妙不生效」且难以排查。
   *
   * 回收是尽力而为：失败仅记录告警，不影响取题。
   */
  private async pruneStaleChunks(): Promise<void> {
    if (!this.chunkStore) return;
    if (this.prunedForBuildId === this.buildId) return; // 同版本只清一次
    this.prunedForBuildId = this.buildId;
    try {
      const keys = await this.chunkStore.keys();
      const stale = keys.filter(k => !k.startsWith(`${this.buildId}@`));
      if (stale.length === 0) return;
      await Promise.all(stale.map(k => this.chunkStore!.delete(k)));
      console.info('[BuiltinLibrary] 已回收历史版本的块缓存', {
        buildId: this.buildId, removed: stale.length,
      });
    } catch (e) {
      console.warn('[BuiltinLibrary] 块缓存回收失败（不影响取题）', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * 确保 buildId 已就绪（索引已加载）。
   * fetchMeta / fetchChunk 可能被直接调用而不经过 listDates，此时 buildId 仍为空串，
   * 会让缓存键退化成旧格式 —— 旧块缓存会被误命中。
   * 失败时不抛出：索引不可用时退化为空前缀，行为同改动前。
   */
  private async ensureBuildId(): Promise<void> {
    if (this.indexCache) return;
    try {
      await this.loadIndex();
    } catch {
      /* 索引不可用：退化为空 buildId */
    }
  }

  /** 持久化缓存键前缀：构建版本（同日重复构建时键变，旧内容自然失效） */
  private cacheKey(key: string): string {
    return `${this.buildId}@${key}`;
  }

  /** 列出某分类下的日期（新→旧） */
  async listDates(category: string): Promise<string[]> {
    const cats = await this.loadIndex();
    return (cats[category] ?? []).slice();
  }



  /**
   * 读取某分类+日期的轻量元数据索引（仅题库分类生成）。
   * 列表与筛选只走这份索引：体积约 71KB（对比整包 3.4MB），
   * 且无需 bz2 解压（实测全包解压 1.4s 是列表加载的主要耗时）。
   */
  async fetchMeta(category: string, date: string): Promise<BuiltinLibraryMeta> {
    const key = `${category}/${date}`;
    const cached = this.metaCache.get(key);
    if (cached !== undefined) return cached;
    // 缓存键依赖 buildId，而 buildId 取自索引：若调用方没先走 listDates
    // （如直接按 lib:// URL 打开），这里要先确保索引已加载，否则键会退化成 '' 前缀
    await this.ensureBuildId();
    const url = `${this.dataUrl}/${category}/${date}.meta.json.gz`;
    let compressed: Uint8Array | null = null;
    // ① 持久化缓存命中（免网络）
    if (this.chunkStore) {
      try {
        compressed = await this.chunkStore.get(this.cacheKey(`meta/${key}`));
      } catch {
        compressed = null;
      }
    }
    // ② 网络下载
    if (!compressed) {
      const response = await this.network.request<ArrayBuffer>({
        url,
        method: 'GET',
        responseType: 'arraybuffer',
      });
      compressed = new Uint8Array(response.data);
      if (this.chunkStore) {
        try {
          await this.chunkStore.set(this.cacheKey(`meta/${key}`), compressed);
        } catch {
          /* 缓存失败不影响本次读取 */
        }
      }
    }
    const isGz = compressed[0] === 0x1f && compressed[1] === 0x8b;
    const text = isGz ? pako.ungzip(compressed, { to: 'string' }) : new TextDecoder().decode(compressed);
    const meta = JSON.parse(text) as BuiltinLibraryMeta;
    // 必填字段校验：数据由构建脚本统一产出，缺字段即视为损坏，直接抛错而非静默降级
    if (
      typeof meta?.count !== 'number' ||
      typeof meta?.chunkSize !== 'number' ||
      !Array.isArray(meta?.chunks)
    ) {
      throw new Error(`元数据索引格式损坏：${category}/${date}`);
    }
    this.metaCache.set(key, meta);
    return meta;
  }

  /**
   * 读取某个分块的 SGF 列表（按块下载+解压，带双层缓存）。
   * 分块的意义：取 1 条不必下载解压全包（题库 3.3MB / 1.8s，棋谱 2.8MB / 824ms）；
   * 实测题库 1000 条/块时单块 ~83KB / 解压 ~31ms，棋谱 50 条/块时单块 274KB / 解压 119ms。
   */
  async fetchChunk(category: string, date: string, partIndex: number): Promise<KatagoSgfEntry[]> {
    const key = `${category}/${date}/${partIndex}`;
    const mem = this.chunkCache.get(key);
    if (mem) return mem;
    // 同 fetchMeta：确保 buildId 已就绪，避免缓存键退化
    await this.ensureBuildId();

    const partName = `${date}.p${String(partIndex).padStart(4, '0')}.tar.bz2`;
    const url = `${this.dataUrl}/${category}/${partName}`;

    let compressed: Uint8Array | null = null;
    // ① 持久化缓存命中：免网络
    if (this.chunkStore) {
      try {
        compressed = await this.chunkStore.get(this.cacheKey(key));
      } catch {
        compressed = null; // 读缓存失败不应阻断，回退到网络
      }
    }
    // ② 网络下载
    if (!compressed) {
      const response = await this.network.request<ArrayBuffer>({ url, method: 'GET', responseType: 'arraybuffer' });
      compressed = new Uint8Array(response.data);
      // ③ 回写持久化缓存（失败不影响本次取题）
      if (this.chunkStore) {
        try {
          await this.chunkStore.set(this.cacheKey(key), compressed);
        } catch (e) {
          console.warn('[BuiltinLibrary] 块缓存写入失败（不影响本次取题）', {
            key, error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    const tarData = decompressBz2(compressed);
    const entries = parseTar(tarData)
      .filter(f => f.name.toLowerCase().endsWith('.sgf'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(f => ({ filename: f.name, sgfContent: new TextDecoder('utf-8').decode(f.data) }));
    this.chunkCache.set(key, entries);
    return entries;
  }

  /**
   * 按下标取单条 SGF：只下载解压该下标所属的块。
   * @throws 元数据缺失或下标越界
   */
  async fetchEntryByIndex(category: string, date: string, index: number): Promise<KatagoSgfEntry> {
    const meta = await this.fetchMeta(category, date);
    if (!meta) throw new Error(`缺少元数据索引：${category}/${date}`);
    if (index < 0 || index >= meta.count) {
      throw new Error(`索引 ${index} 超出范围（共 ${meta.count} 条）`);
    }
    const partIndex = Math.floor(index / meta.chunkSize);
    const chunk = meta.chunks[partIndex];
    if (!chunk) throw new Error(`元数据块信息缺失：${category}/${date}#${partIndex}`);
    const entries = await this.fetchChunk(category, date, partIndex);
    const localIndex = index - chunk.start;
    const entry = entries[localIndex];
    if (!entry) throw new Error(`块内下标缺失：${category}/${date}#${index}`);
    return entry;
  }

  /**
   * 取某个分类+日期下 [0, limit) 范围的条目（按需只下载覆盖该范围的块）。
   *
   * 用途：定式发现批量取谱等场景只需前 N 盘，若解压整包
   * （棋谱 2.8MB / 824ms，且其解压结果 18.9MB 会常驻内存）代价远超所需。
   */
  async fetchEntriesRange(category: string, date: string, limit: number): Promise<KatagoSgfEntry[]> {
    if (limit <= 0) return [];
    const meta = await this.fetchMeta(category, date);
    if (!meta) throw new Error(`缺少元数据索引：${category}/${date}`);
    const want = Math.min(limit, meta.count);
    if (want === 0) return [];
    const out: KatagoSgfEntry[] = [];
    const lastPart = Math.floor((want - 1) / meta.chunkSize);
    for (let p = 0; p <= lastPart && out.length < want; p++) {
      const entries = await this.fetchChunk(category, date, p);
      for (const e of entries) {
        if (out.length >= want) break;
        out.push(e);
      }
    }
    return out;
  }

  /**
   * 适配 listPublicGames：返回伪 URL 列表，展开每个日期下的棋谱。
   *
   * 按需取块：先读 meta 得到总数，再只下载覆盖 count 所需的块，避免为取 10 盘
   * 而解压整包（棋谱 2.8MB / 824ms、且其解压结果 18.9MB 会常驻内存）。
   */
  async listPublicGames(category: string, date?: string, count?: number): Promise<string[]> {
    const dates = await this.listDates(category);
    const usable = date ? dates.filter(d => d === date) : dates;
    const urls: string[] = [];
    for (const d of usable) {
      const meta = await this.fetchMeta(category, d);
      if (!meta) throw new Error(`缺少元数据索引：${category}/${d}`);
      // 目标条数：不传 count 则取全部
      const want = count ? Math.min(count - urls.length, meta.count) : meta.count;
      for (let i = 0; i < want; i++) {
        urls.push(`lib://${category}/${d}/${i}`);
      }
      if (want > 0) {
        // 只下载覆盖 [0, want) 的块（预热缓存，后续 fetch 直接命中内存）
        const lastPart = Math.floor((want - 1) / meta.chunkSize);
        for (let p = 0; p <= lastPart; p++) {
          await this.fetchChunk(category, d, p);
        }
      }
      if (count && urls.length >= count) break;
    }
    return urls;
  }
}

/**
 * IGameProvider 适配：将内置库接入 GameService 标准流程。
 */
export class BuiltinLibraryProvider extends BaseProvider {
  readonly name = 'lib';
  readonly displayName = '内置棋谱';
  readonly urlPatterns = [
    /^lib:\/\/(life-and-death|ai-review)\/(\d{4}-\d{2}-\d{2})(?:\/(\d+))?/,
  ];

  constructor(
    network: NetworkManager,
    private readonly archive: BuiltinLibraryArchiveProvider,
  ) {
    super(network);
  }

  /**
   * 展开某分类的「最新」列表（供 FetcherApp.fetchLatestGames 使用）。
   * 题库（life-and-death）的 subtitle 为题目标签「类型·难度」（从 SGF PW 字段解析），
   * 棋谱（ai-review）的 subtitle 为 md5(id)。
   * @param keyword - 可选筛选表达式（支持 and/or 语法，如 "(官子 or 死活) and 2D"），仅对题库生效
   */
  async listGameItems(category: string, count?: number, keyword?: string): Promise<BuiltinLibraryGameItem[]> {
    const kw = keyword?.trim() || '';
    const dates = await this.archive.listDates(category);
    const results: BuiltinLibraryGameItem[] = [];
    const isLifeAndDeath = category === 'life-and-death';
    for (const date of dates) {
      if (count && results.length >= count) break;
      try {
        // 两个分类都走轻量元数据索引：列表只需一条标签/id 字符串，
        // 为此解压整包（题库 1.4s / 49MB，棋谱 824ms / 18.9MB）纯属浪费。
        // meta 体积：题库 ~71KB（pw），棋谱 ~12KB（ids）。
        const meta = await this.archive.fetchMeta(category, date);
        if (!meta) throw new Error(`缺少元数据索引：${category}/${date}`);
        if (isLifeAndDeath) {
          const pw = meta.pw ?? [];
          for (let i = 0; i < pw.length; i++) {
            if (count && results.length >= count) break;
            const raw = pw[i]!.trim();
            const tags = splitPuzzleTags(raw);
            if (kw && !evaluateFilter(kw, tags)) continue;
            results.push({
              source: 'lib-life-death',
              title: '#' + (i + 1),
              subtitle: raw,
              date,
              url: `lib://${category}/${date}/${i}`,
            });
          }
          continue;
        }
        // 棋谱：subtitle 为 md5 id，直接读 meta.ids（不再解包）
        const ids = meta.ids ?? [];
        for (let i = 0; i < ids.length; i++) {
          if (count && results.length >= count) break;
          results.push({
            source: 'lib-ai-review',
            title: '#' + (i + 1),
            subtitle: ids[i] ?? '',
            date,
            url: `lib://${category}/${date}/${i}`,
          });
        }
      } catch (e) {
        console.error('[BuiltinLibraryProvider] 加载', category, date, '失败', e);
      }
    }
    return results;
  }

  async fetch(url: string): Promise<FetchResult> {
    const timing: PerformanceTiming = {};
    const start = this.now();
    const match = url.match(/^lib:\/\/(life-and-death|ai-review)\/(\d{4}-\d{2}-\d{2})(?:\/(\d+))?/);
    if (!match) {
      return this.createErrorResult(url, '无效的 lib URL 格式', timing);
    }
    const category = match[1]!;
    const date = match[2]!;
    const index = match[3] ? parseInt(match[3], 10) : 0;
    try {
      // 只下载/解压该下标所属的块，避免整包（题库 3.3MB / 棋谱 2.8MB）
      const entry = await this.archive.fetchEntryByIndex(category, date, index);
      const sgf = entry.sgfContent;
      const parsed = parseSGF(sgf);
      const info = parsed.gameInfo;
      timing.total = this.now() - start;
      const id = entry.filename.replace(/\.sgf$/i, '');
      const metadata: GameMetadata = {
        source: this.name,
        gameId: id,
        blackName: info.black || '黑棋',
        whiteName: info.white || '白棋',
        blackRank: info.blackRank || '',
        whiteRank: info.whiteRank || '',
        width: info.boardSize || 19,
        height: info.boardSize || 19,
        komi: parseFloat(info.komi) || 0,
        handicap: info.handicap ?? 0,
        rules: info.rules || 'chinese',
        date,
        result: info.result || '',
        movesCount: parsed.moves.length,
      };
      return { success: true, source: category === 'life-and-death' ? 'lib-life-death' : 'lib-ai-review', url, sgfContent: sgf, metadata, timing };
    } catch (error) {
      return this.createErrorResult(url, '下载失败: ' + (error instanceof Error ? error.message : String(error)), timing);
    }
  }
}
