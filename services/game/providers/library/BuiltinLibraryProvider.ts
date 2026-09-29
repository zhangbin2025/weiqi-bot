/**
 * @fileoverview 内置棋谱库归档提供者
 * @description 从本机打包的内置棋谱库（clients/web/shared/assets/data/games）读取 .tar.bz2，
 *              按分类加载 SGF（每分类一个归档包，日期标签为最新日期）。
 *
 * 数据格式：与 KataGo 归档一致，每分类一个 YYYY-MM-DD.tar.bz2（日期为最新日期），内含若干 <id>.sgf。
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
 * 归档读取器：负责 index.json.gz 与 .tar.bz2 的下载、解压、内存缓存。
 */
export class BuiltinLibraryArchiveProvider {
  private readonly dataUrl: string;
  private indexCache: Record<string, string[]> | null = null;
  private gamesCache: Map<string, KatagoSgfEntry[]> = new Map();

  constructor(
    private readonly network: NetworkManager,
    config?: BuiltinLibraryConfig,
  ) {
    this.dataUrl = (config?.dataUrl ?? DEFAULT_GAMES_BASE).replace(/\/+$/, '');
  }

  /** 读取索引，返回 { category: [dates...] } */
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
    const idx = JSON.parse(text) as { categories?: Record<string, string[]> };
    this.indexCache = idx.categories ?? {};
    return this.indexCache;
  }

  /** 列出某分类下的日期（新→旧） */
  async listDates(category: string): Promise<string[]> {
    const cats = await this.loadIndex();
    return (cats[category] ?? []).slice();
  }

  /** 下载某分类+日期的压缩包并解压得到 SGF 列表（按文件名排序 = 包内 id 排序） */
  async fetchGamesByDate(category: string, date: string): Promise<KatagoSgfEntry[]> {
    const key = `${category}/${date}`;
    const cached = this.gamesCache.get(key);
    if (cached) return cached;
    const url = `${this.dataUrl}/${category}/${date}.tar.bz2`;
    const response = await this.network.request<ArrayBuffer>({
      url,
      method: 'GET',
      responseType: 'arraybuffer',
    });
    const compressed = new Uint8Array(response.data);
    const tarData = decompressBz2(compressed);
    const files = parseTar(tarData)
      .filter(f => f.name.toLowerCase().endsWith('.sgf'))
      .sort((a, b) => a.name.localeCompare(b.name));
    const entries = files.map(f => ({
      filename: f.name,
      sgfContent: new TextDecoder('utf-8').decode(f.data),
    }));
    this.gamesCache.set(key, entries);
    return entries;
  }

  /** 适配 listPublicGames：返回伪 URL 列表（每日期一条，指向该日第 0 盘） */
  async listPublicGames(category: string, date?: string, count?: number): Promise<string[]> {
    const dates = await this.listDates(category);
    const usable = date ? dates.filter(d => d === date) : dates;
    const urls: string[] = [];
    for (const d of usable) {
      urls.push(`lib://${category}/${d}/0`);
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
   * title="#N"，subtitle 为 md5(id)（可追溯），date 为包日期。
   */
  async listGameItems(category: string, count?: number): Promise<BuiltinLibraryGameItem[]> {
    const dates = await this.archive.listDates(category);
    const results: BuiltinLibraryGameItem[] = [];
    for (const date of dates) {
      if (count && results.length >= count) break;
      try {
        const games = await this.archive.fetchGamesByDate(category, date);
        for (let i = 0; i < games.length; i++) {
          if (count && results.length >= count) break;
          const id = games[i]!.filename.replace(/\.sgf$/i, '');
          results.push({
            source: 'lib',
            title: '#' + (i + 1),
            subtitle: id,
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
      const entries = await this.archive.fetchGamesByDate(category, date);
      if (entries.length === 0) {
        return this.createErrorResult(url, '该日期无可用棋谱', timing);
      }
      if (index >= entries.length) {
        return this.createErrorResult(url, `索引 ${index} 超出范围（共 ${entries.length} 盘）`, timing);
      }
      const entry = entries[index]!;
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
      return { success: true, source: this.name, url, sgfContent: sgf, metadata, timing };
    } catch (error) {
      return this.createErrorResult(url, '下载失败: ' + (error instanceof Error ? error.message : String(error)), timing);
    }
  }
}
