/**
 * @fileoverview KataGo Archive 棋谱提供者
 * @description 从 katagoarchive.org 下载 .tar.bz2 压缩包并解压获取 SGF 棋谱
 */

import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';

import type { KatagoArchiveEntry, KatagoSgfEntry } from './types';

/** KataGo Archive 基础 URL */
const KATAGO_ARCHIVE_INDEX = 'https://katagoarchive.org/kata1/ratinggames/index.html';
const KATAGO_ARCHIVE_DIR = 'https://katagoarchive.org/kata1/ratinggames/';

/**
 * KataGo Archive 提供者
 *
 * 数据格式：每天一个 YYYY-MM-DDrating.tar.bz2 压缩包，内含多个 SGF 文件。
 */
export class KatagoArchiveProvider {
  constructor(private readonly network: NetworkManager) {}

  /**
   * 获取可用归档日期列表（从新到旧）
   * @param count - 最多返回几个日期，默认全部
   */
  async listArchiveDates(count?: number): Promise<KatagoArchiveEntry[]> {
    const response = await this.network.request<string>({
      url: KATAGO_ARCHIVE_INDEX,
      method: 'GET',
      responseType: 'text',

    });

    const html = response.data;
    const entries: KatagoArchiveEntry[] = [];

    // 解析目录列表：匹配 YYYY-MM-DDrating.tar.bz2 链接
    // 格式：<a href="./2020-12-08rating.tar.bz2">2020-12-08rating.tar.bz2</a>
    const regex = /<a[^>]*href="\.\/(\d{4}-\d{2}-\d{2})rating\.tar\.bz2"[^>]*>/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(html)) !== null) {
      const date = match[1]!;
      entries.push({
        date,
        url: `${KATAGO_ARCHIVE_DIR}${date}rating.tar.bz2`,
        size: 0, // size 不从目录页解析，避免复杂度
      });
    }

    // 日期降序排列（最新在前）
    entries.sort((a, b) => b.date.localeCompare(a.date));

    if (count) {
      return entries.slice(0, count);
    }
    return entries;
  }

  /**
   * 下载指定日期的压缩包并解压得到 SGF 列表
   * @param date - 日期 YYYY-MM-DD
   * @param limit - 最多取多少盘棋，按文件名排序
   */
  async fetchGamesByDate(date: string, limit?: number): Promise<KatagoSgfEntry[]> {
    const url = `${KATAGO_ARCHIVE_DIR}${date}rating.tar.bz2`;

    const response = await this.network.request<ArrayBuffer>({
      url,
      method: 'GET',
      responseType: 'arraybuffer',

    });

    const compressedData = new Uint8Array(response.data);
    return KatagoArchiveProvider.extractSgfFromTarBz2(compressedData, limit);
  }

  /**
   * 从 tar.bz2 数据中提取 SGF 文件
   * @param compressedData - bz2 压缩的 tar 数据
   * @param limit - 最多取多少个文件
   */
  static extractSgfFromTarBz2(compressedData: Uint8Array, limit?: number): KatagoSgfEntry[] {
    // 1. bz2 解压 → tar 数据
    const tarData = decompressBz2(compressedData);

    // 2. 解析 tar → 文件列表
    const files = parseTar(tarData);

    // 3. 过滤 .sgf 文件（保持 tar 内原始顺序，与 Python 一致）
    const sgfFiles = files
      .filter(f => f.name.toLowerCase().endsWith('.sgf'))
      

    // 4. 截取 limit
    const selected = limit ? sgfFiles.slice(0, limit) : sgfFiles;

    return selected.map(f => {
      let sgfContent = new TextDecoder('utf-8').decode(f.data);
      sgfContent = shortenKatagoPlayerNames(sgfContent);
      return {
        filename: f.name,
        sgfContent,
      };
    });
  }

  /**
   * 获取公开棋谱（适配 IGameService.listPublicGames 语义）
   *
   * 与 foxwq 不同，KataGo 返回的是 SGF 内容数组而非 URL 数组。
   * 但为了与现有流程兼容，这里返回的 "URL" 实际是 katago://date/YYYY-MM-DD 的伪 URL。
   * 实际的 SGF 内容由 fetchGamesByDate 直接提供。
   *
   * @param date - 日期 YYYY-MM-DD，或 undefined 表示"全部"
   * @param count - 最多取多少盘棋
   */
  async listPublicGames(date?: string, count?: number): Promise<string[]> {
    if (date) {
      // 指定日期：返回伪 URL，标识这一天
      return [`katago://date/${date}`];
    }

    // "全部"模式：从最新日期开始，一天一天抓，直到凑够 count 盘
    const allDates = await this.listArchiveDates();
    const urls: string[] = [];

    for (const entry of allDates) {
      urls.push(`katago://date/${entry.date}`);
      if (count && urls.length >= count) break;
    }

    return urls;
  }
}

// ========== bz2 解压 ==========

// bz2 是 CJS 模块，Vite 转为 ESM 后导出结构可能是：
//   { default: { decompress: fn }, decompress: fn }  (命名导出正确)
//   或 { default: { decompress: fn } }                (只有 default)
// 运行时检测并缓存
// seek-bzip 依赖 Node.js Buffer，浏览器环境需要 polyfill
import { Buffer as BufferPolyfill } from 'buffer';
if (typeof globalThis.Buffer === 'undefined') { (globalThis as any).Buffer = BufferPolyfill; }

// @ts-ignore - seek-bzip has no type declarations
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

/**
 * 使用 bz2 库解压 bzip2 数据
 */
function decompressBz2(data: Uint8Array): Uint8Array {
  return _bz2Decompress(data);
}

// ========== tar 解析 ==========

interface TarFile {
  name: string;
  size: number;
  data: Uint8Array;
}

/**
 * 解析 tar 格式数据，提取所有文件
 * tar 格式：每个文件一个 512 字节 header + 数据（512 字节对齐）
 */
function parseTar(tarData: Uint8Array): TarFile[] {
  const files: TarFile[] = [];
  let offset = 0;

  while (offset + 512 <= tarData.length) {
    // 读取 header
    const header = tarData.subarray(offset, offset + 512);

    // 文件名：0-100 字节
    const name = readTarString(header, 0, 100);

    // 全为 0 表示 tar 结束
    if (!name || header[0] === 0) break;

    // 文件大小：124-136 字节（八进制字符串）
    const sizeStr = readTarString(header, 124, 12);
    const size = parseInt(sizeStr, 8) || 0;

    // 类型标志：第 156 字节
    const typeFlag = header[156];

    offset += 512; // 跳过 header

    // 只处理普通文件（'0' 或 '\0'）
    if (typeFlag === 0 || typeFlag === 0x30) { // 0x30 = '0'
      if (size > 0 && offset + size <= tarData.length) {
        const data = tarData.subarray(offset, offset + size);
        files.push({ name, size, data: new Uint8Array(data) });
      }
    }

    // 数据对齐到 512 字节边界
    offset += Math.ceil(size / 512) * 512;
  }

  return files;
}

/**
 * 从 tar header 中读取空字符结尾的字符串
 */
function readTarString(buffer: Uint8Array, offset: number, length: number): string {
  let end = offset + length;
  for (let i = offset; i < end; i++) {
    if (buffer[i] === 0) {
      end = i;
      break;
    }
  }
  return new TextDecoder('ascii').decode(buffer.subarray(offset, end)).trim();
}

/**
 * 截取 KataGo AI 模型名
 *
 * KataGo 模型名格式：kata1-zhizi-b40c768nbt-s11472M-d5982M
 * 截取规则：提取 b{blocks}c{channels}{suffix} 部分 → b40c768nbt
 * 如果不匹配 KataGo 模型名模式，保持原样
 *
 * @param name - 原始棋手名
 * @returns 截取后的短名
 */
function shortenKatagoModelName(name: string): string {
  // 匹配 KataGo 模型名中的 bXXcYY[suffix] 模式
  const match = name.match(/(b\d+c\d+[a-z]*)/i);
  return match ? match[1]! : name;
}

/**
 * 对 SGF 内容中的 PB/PW 属性值进行 AI 模型名截取
 *
 * 仅当名字看起来像 KataGo AI 模型名时才截取（包含 kata 或 b\d+c\d+ 模式）
 *
 * @param sgf - SGF 内容
 * @returns 处理后的 SGF 内容
 */
function shortenKatagoPlayerNames(sgf: string): string {
  // 匹配 PB[...] 或 PW[...] 中的值
  return sgf.replace(/(P[BW])\[([^\]]+)\]/g, (_match, prop: string, name: string) => {
    // 仅对包含 KataGo 模型名特征的进行截取
    if (/b\d+c\d+/i.test(name)) {
      const shortened = shortenKatagoModelName(name);
      return `${prop}[${shortened}]`;
    }
    return `${prop}[${name}]`;
  });
}
