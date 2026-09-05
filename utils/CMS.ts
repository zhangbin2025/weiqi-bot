/**
 * Count-Min Sketch 实现
 * 对应 Python: weiqi-joseki/src/utils/cms.py
 *
 * 使用 MD5 哈希，支持二进制序列化/反序列化（对齐 Python pickle）
 */

import * as crypto from "crypto";
import * as fs from "fs";

export interface CMSConfig {
  width: number;
  depth: number;
}

export class CountMinSketch {
  private width: number;
  private depth: number;
  private table: Uint32Array;
  private size: number = 0;

  constructor(config: CMSConfig | number = 200000, depth?: number) {
    if (typeof config === "number") {
      this.width = config;
      this.depth = depth ?? 5;
    } else {
      this.width = config.width;
      this.depth = config.depth;
    }
    this.table = new Uint32Array(this.width * this.depth);
  }

  /** MD5 哈希（与 Python 版 hashlib.md5 一致） */
  private hash(item: string, seed: number): number {
    const data = seed + ":" + item;
    const buf = crypto.createHash("md5").update(data, "utf8").digest();
    return buf.readUInt32LE(0) % this.width;
  }

  /** 更新元素计数 */
  update(item: string, count: number = 1): void {
    for (let i = 0; i < this.depth; i++) {
      const idx = i * this.width + this.hash(item, i);
      this.table[idx] = (this.table[idx] ?? 0) + count;
    }
    this.size += count;
  }

  /** 估算元素出现次数 */
  estimate(item: string): number {
    let minCount = Infinity;
    for (let i = 0; i < this.depth; i++) {
      const idx = i * this.width + this.hash(item, i);
      const val = this.table[idx] ?? 0;
      if (val < minCount) minCount = val;
    }
    return minCount === Infinity ? 0 : minCount;
  }

  getSize(): number { return this.size; }
  getConfig(): CMSConfig { return { width: this.width, depth: this.depth }; }
  clear(): void { this.table.fill(0); this.size = 0; }

  /**
   * 保存到二进制文件（对齐 Python pickle 的 save_to_file）
   *
   * 格式：header(12B) + table(width*depth*4B)
   *   header: uint32 width | uint32 depth | uint32 size
   *
   * 直接写入 ArrayBuffer，不经过 JSON，零额外内存开销
   */
  saveToFile(filePath: string): void {
    const headerSize = 12;
    const tableBytes = this.table.byteLength;
    const buf = Buffer.alloc(headerSize + tableBytes);
    buf.writeUInt32LE(this.width, 0);
    buf.writeUInt32LE(this.depth, 4);
    buf.writeUInt32LE(this.size, 8);
    // 直接从 Uint32Array 复制到 Buffer
    const tableView = Buffer.from(this.table.buffer, this.table.byteOffset, tableBytes);
    tableView.copy(buf, headerSize);
    fs.writeFileSync(filePath, buf);
  }

  /**
   * 从二进制文件加载（对齐 Python pickle 的 load_from_file）
   *
   * 直接读取为 Uint32Array，零拷贝，内存开销 = table 本身
   */
  static loadFromFile(filePath: string): CountMinSketch {
    const buf = fs.readFileSync(filePath);
    const width = buf.readUInt32LE(0);
    const depth = buf.readUInt32LE(4);
    const size = buf.readUInt32LE(8);
    const tableByteLength = buf.length - 12;
    const expectedBytes = width * depth * 4;
    if (tableByteLength !== expectedBytes) {
      throw new Error(
        `CMS file corrupted: expected ${expectedBytes} bytes for table, got ${tableByteLength}`
      );
    }
    // 复制到独立的 ArrayBuffer（不引用 Buffer 的内存，避免被 GC 释放）
    const table = new Uint32Array(width * depth);
    const tableView = Buffer.from(buf.buffer, buf.byteOffset + 12, tableByteLength);
    table.set(new Uint32Array(tableView.buffer, tableView.byteOffset, width * depth));
    const cms = new CountMinSketch({ width, depth });
    cms.table = table;
    cms.size = size;
    return cms;
  }

  /** 兼容旧 JSON 格式加载（用于迁移） */
  static fromJSON(data: { width: number; depth: number; table: number[]; size: number }): CountMinSketch {
    const cms = new CountMinSketch({ width: data.width, depth: data.depth });
    cms.table = new Uint32Array(data.table);
    cms.size = data.size;
    return cms;
  }

  /** 兼容旧 JSON 格式导出 */
  toJSON(): { width: number; depth: number; table: number[]; size: number } {
    return { width: this.width, depth: this.depth, table: Array.from(this.table), size: this.size };
  }
}
