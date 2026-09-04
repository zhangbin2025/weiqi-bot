/**
 * 小顶堆 + 堆项
 * 对应 Python: weiqi-joseki/src/builder/katago_builder.py (HeapItem, MinHeap)
 *
 * 用于定式构建 Phase 2-3 的 top-k 选择
 */

/** 胜率中性阈值 */
const NEUTRAL_THRESHOLD = 0.005;

/** 堆项：记录一个定式前缀的频率和胜率统计 */
export class HeapItem {
  count: number;
  prefix: string;
  direction: string;
  prefixHash: string;
  wrDeltaSum = 0;
  wrDeltaSqSum = 0;
  wrSamples = 0;
  wrPositiveCount = 0;
  wrNegativeCount = 0;
  wrNeutralCount = 0;

  constructor(count: number, prefix: string, direction: string, prefixHash: string) {
    this.count = count;
    this.prefix = prefix;
    this.direction = direction;
    this.prefixHash = prefixHash;
  }

  static compare(a: HeapItem, b: HeapItem): number {
    return a.count - b.count;
  }

  addWinrate(startWr: number, endWr: number): void {
    const delta = endWr - startWr;
    this.wrDeltaSum += delta;
    this.wrDeltaSqSum += delta * delta;
    this.wrSamples += 1;
    if (delta > NEUTRAL_THRESHOLD) this.wrPositiveCount += 1;
    else if (delta < -NEUTRAL_THRESHOLD) this.wrNegativeCount += 1;
    else this.wrNeutralCount += 1;
  }

  getWinrateStats(): Record<string, unknown> | null {
    if (this.wrSamples === 0) return null;
    const avg = this.wrDeltaSum / this.wrSamples;
    let std = 0;
    if (this.wrSamples > 1) {
      const variance = this.wrDeltaSqSum / this.wrSamples - avg * avg;
      std = Math.sqrt(Math.max(0, variance));
    }
    return {
      delta: Math.round(avg * 10000) / 10000,
      stddev: Math.round(std * 10000) / 10000,
      samples: this.wrSamples,
      positive: this.wrPositiveCount,
      negative: this.wrNegativeCount,
      neutral: this.wrNeutralCount,
    };
  }
}

/** 小顶堆：保持 top-k 个频率最高的定式 */
export class MinHeap {
  private heap: HeapItem[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get size(): number { return this.heap.length; }
  get min(): HeapItem | undefined { return this.heap[0]; }

  push(item: HeapItem): void {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
    if (this.heap.length > this.maxSize) {
      this.heap.shift();
      this.bubbleDown(0);
    }
  }

  replaceMin(item: HeapItem): HeapItem | undefined {
    if (this.heap.length === 0) {
      this.heap.push(item);
      return undefined;
    }
    const old = this.heap[0]!;
    this.heap[0] = item;
    this.bubbleDown(0);
    return old;
  }

  toArray(): HeapItem[] {
    // 与 Python 一致：直接输出堆数组，不排序
    // Python heap 是 min-heap，遍历顺序即堆数组顺序
    return [...this.heap];
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (HeapItem.compare(this.heap[i]!, this.heap[p]!) >= 0) break;
      [this.heap[i], this.heap[p]] = [this.heap[p]!, this.heap[i]!];
      i = p;
    }
  }

  private bubbleDown(i: number): void {
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let s = i;
      if (l < this.heap.length && HeapItem.compare(this.heap[l]!, this.heap[s]!) < 0) s = l;
      if (r < this.heap.length && HeapItem.compare(this.heap[r]!, this.heap[s]!) < 0) s = r;
      if (s === i) break;
      [this.heap[i], this.heap[s]] = [this.heap[s]!, this.heap[i]!];
      i = s;
    }
  }
}
