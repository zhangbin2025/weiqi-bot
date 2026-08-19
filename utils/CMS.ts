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
    if (typeof config === 'number') {
      this.width = config;
      this.depth = depth ?? 5;
    } else {
      this.width = config.width;
      this.depth = config.depth;
    }
    this.table = new Uint32Array(this.width * this.depth);
  }

  private hash(item: string, seed: number): number {
    let hash = 2166136261 ^ seed;
    for (let i = 0; i < item.length; i++) {
      hash ^= item.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return hash % this.width;
  }

  update(item: string, count: number = 1): void {
    for (let i = 0; i < this.depth; i++) {
      const idx = i * this.width + this.hash(item, i);
      const current = this.table[idx] ?? 0;
      this.table[idx] = current + count;
    }
    this.size += count;
  }

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

  toJSON(): { width: number; depth: number; table: number[]; size: number } {
    return { width: this.width, depth: this.depth, table: Array.from(this.table), size: this.size };
  }

  static fromJSON(data: { width: number; depth: number; table: number[]; size: number }): CountMinSketch {
    const cms = new CountMinSketch({ width: data.width, depth: data.depth });
    cms.table = new Uint32Array(data.table);
    cms.size = data.size;
    return cms;
  }

  getConfig(): CMSConfig { return { width: this.width, depth: this.depth }; }
  clear(): void { this.table.fill(0); this.size = 0; }
}
