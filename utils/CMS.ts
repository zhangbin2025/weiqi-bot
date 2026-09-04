/**
 * Count-Min Sketch 实现
 * 对应 Python: weiqi-joseki/src/utils/cms.py
 *
 * 使用 FNV-1a 哈希，支持序列化/反序列化
 */

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

  /** FNV-1a 哈希（与 Python 版一致） */
  private hash(item: string, seed: number): number {
    let h = 2166136261 ^ seed;
    for (let i = 0; i < item.length; i++) {
      h ^= item.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h % this.width;
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

  /** 序列化为 JSON */
  toJSON(): { width: number; depth: number; table: number[]; size: number } {
    return { width: this.width, depth: this.depth, table: Array.from(this.table), size: this.size };
  }

  /** 从 JSON 反序列化 */
  static fromJSON(data: { width: number; depth: number; table: number[]; size: number }): CountMinSketch {
    const cms = new CountMinSketch({ width: data.width, depth: data.depth });
    cms.table = new Uint32Array(data.table);
    cms.size = data.size;
    return cms;
  }
}
