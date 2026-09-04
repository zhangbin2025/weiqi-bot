/**
 * 定式库构建器 - Domain 层核心算法
 * 
 * 核心流程：
 * 1. Phase 1: CMS统计频率 + 临时存储
 * 2. Phase 2-3: 逆向遍历 + 单链检测 + 小顶堆选top-k  
 * 3. Phase 4: 入库
 */

import { CountMinSketch } from '../../utils/CMS.js';

/** 单链检测阈值 */
const SINGLE_CHAIN_THRESHOLD = 0.05;

/** 有效第一手坐标（右上角ruld视角） */
const VALID_FIRST_MOVES = new Set(['pd', 'qc', 'pc', 'oe', 'oc', 'nc', 'od', 'nd', 'ne', 'me']);

/** 堆项 - 用于小顶堆选top-k */
export class HeapItem {
  count: number;
  prefix: string;
  direction: string;
  prefixHash: string;
  
  // 胜率统计
  wrDeltaSum: number = 0;
  wrDeltaSqSum: number = 0;
  wrSamples: number = 0;
  wrPositiveCount: number = 0;
  wrNegativeCount: number = 0;
  wrNeutralCount: number = 0;
  
  static readonly NEUTRAL_THRESHOLD = 0.005;
  
  constructor(count: number, prefix: string, direction: string, prefixHash: string) {
    this.count = count;
    this.prefix = prefix;
    this.direction = direction;
    this.prefixHash = prefixHash;
  }
  
  /** 比较函数（小顶堆） */
  static compare(a: HeapItem, b: HeapItem): number {
    return a.count - b.count;
  }
  
  /** 累积胜率数据 */
  addWinrate(startWr: number, endWr: number): void {
    const delta = endWr - startWr;
    this.wrDeltaSum += delta;
    this.wrDeltaSqSum += delta * delta;
    this.wrSamples += 1;
    
    if (delta > HeapItem.NEUTRAL_THRESHOLD) {
      this.wrPositiveCount += 1;
    } else if (delta < -HeapItem.NEUTRAL_THRESHOLD) {
      this.wrNegativeCount += 1;
    } else {
      this.wrNeutralCount += 1;
    }
  }
  
  /** 获取胜率统计 */
  getWinrateStats(): Record<string, any> | null {
    if (this.wrSamples === 0) return null;
    
    const avgDelta = this.wrDeltaSum / this.wrSamples;
    let stdDelta = 0;
    
    if (this.wrSamples > 1) {
      const variance = (this.wrDeltaSqSum / this.wrSamples) - (avgDelta ** 2);
      stdDelta = Math.sqrt(Math.max(0, variance));
    }
    
    return {
      delta: Math.round(avgDelta * 10000) / 10000,
      stddev: Math.round(stdDelta * 10000) / 10000,
      samples: this.wrSamples,
      positive: this.wrPositiveCount,
      negative: this.wrNegativeCount,
      neutral: this.wrNeutralCount,
    };
  }
}

/** 小顶堆实现 */
class MinHeap {
  private heap: HeapItem[] = [];
  private maxSize: number;
  
  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }
  
  get size(): number {
    return this.heap.length;
  }
  
  get min(): HeapItem | undefined {
    return this.heap[0];
  }
  
  push(item: HeapItem): void {
    this.heap.push(item);
    this._bubbleUp(this.heap.length - 1);
    
    // 超过最大大小，移除最小元素
    if (this.heap.length > this.maxSize) {
      this.heap.shift();
      this._bubbleDown(0);
    }
  }
  
  replaceMin(item: HeapItem): HeapItem | undefined {
    if (this.heap.length === 0) {
      this.heap.push(item);
      return undefined;
    }
    
    const oldMin = this.heap[0]!;
    this.heap[0] = item;
    this._bubbleDown(0);
    return oldMin;
  }
  
  toArray(): HeapItem[] {
    return [...this.heap].sort(HeapItem.compare).reverse();
  }
  
  private _bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (HeapItem.compare(this.heap[index]!, this.heap[parent]!) >= 0) break;
      [this.heap[index], this.heap[parent]] = [this.heap[parent]!, this.heap[index]!];
      index = parent;
    }
  }
  
  private _bubbleDown(index: number): void {
    while (true) {
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      let smallest = index;
      
      if (left < this.heap.length && HeapItem.compare(this.heap[left]!, this.heap[smallest]!) < 0) {
        smallest = left;
      }
      if (right < this.heap.length && HeapItem.compare(this.heap[right]!, this.heap[smallest]!) < 0) {
        smallest = right;
      }
      
      if (smallest === index) break;
      [this.heap[index], this.heap[smallest]] = [this.heap[smallest]!, this.heap[index]!];
      index = smallest;
    }
  }
}

/** 定式数据 */
export interface JosekiItem {
  id: string;
  source: string;
  moves: string[];
  frequency: number;
  probability: number;
  winrateStats?: Record<string, any>;
  createdAt: string;
}

/** 构建配置 */
export interface BuildConfig {
  minFreq: number;
  topK: number;
  minMoves: number;
  maxMoves: number;
  cmsWidth: number;
  cmsDepth: number;
}

/** 序列数据（临时存储） */
export interface SequenceData {
  stdCoords: string[];
  winrates: number[];
  firstColor: string;
}

/**
 * 定式库构建器
 */
export class JosekiBuilder {
  private cms: CountMinSketch;
  private sequences: SequenceData[] = [];
  
  constructor(config: Partial<BuildConfig> = {}) {
    const cmsWidth = config.cmsWidth || 4194304;
    const cmsDepth = config.cmsDepth || 4;
    this.cms = new CountMinSketch(cmsWidth, cmsDepth);
  }
  
  /**
   * 添加序列到构建器
   */
  addSequence(data: SequenceData): void {
    if (data.stdCoords.length < 4) return;
    if (!VALID_FIRST_MOVES.has(data.stdCoords[0]!)) return;
    
    this.sequences.push(data);
    
    // 更新 CMS
    for (let len = 2; len <= data.stdCoords.length; len++) {
      const prefix = data.stdCoords.slice(0, len).join(' ');
      this.cms.update(prefix, 1);
    }
  }
  
  /**
   * 构建定式库
   */
  build(config: Partial<BuildConfig> = {}): JosekiItem[] {
    const minFreq = config.minFreq || 5;
    const topK = config.topK || 10000;
    const minMoves = config.minMoves || 4;
    const maxMoves = config.maxMoves || 50;
    
    console.log('\n🔄 Phase 2-3: 逆向遍历 + 单链检测...');
    
    const heap = new MinHeap(topK);
    const seenHashes = new Map<string, HeapItem>();
    let processedSeq = 0;
    let prefixProcessed = 0;
    let skippedSingleChain = 0;
    
    // 遍历所有序列
    for (const seq of this.sequences) {
      const seqParts = seq.stdCoords;
      const winrates = seq.winrates;
      const direction = 'ruld';
      
      let lastCount = Infinity;
      
      // 逆向遍历前缀（从长到短）
      for (let end = seqParts.length; end >= minMoves; end--) {
        const prefixParts = seqParts.slice(0, end);
        const prefix = prefixParts.join(' ');
        const estCount = this.cms.estimate(prefix);
        
        if (estCount < minFreq) {
          lastCount = estCount;
          continue;
        }
        
        const prefixHash = prefix;
        
        // 单链检测
        if (lastCount !== Infinity) {
          const countDiffRatio = Math.abs(estCount - lastCount) / Math.max(estCount, lastCount, 1);
          if (countDiffRatio < SINGLE_CHAIN_THRESHOLD) {
            skippedSingleChain += 1;
            lastCount = estCount;
            continue;
          }
        }
        
        lastCount = estCount;
        
        // 检查是否已在堆中
        if (seenHashes.has(prefixHash)) {
          // 累积胜率
          const item = seenHashes.get(prefixHash)!;
          if (winrates.length >= end) {
            const startWr = winrates[0] || 0.5;
            const endWr = winrates[end - 1] || 0.5;
            item.addWinrate(startWr, endWr);
          }
          continue; // ✅ 修复：继续检查更长的前缀
        }
        
        // 新项，加入堆
        if (heap.size < topK) {
          const item = new HeapItem(estCount, prefix, direction, prefixHash);
          if (winrates.length >= end) {
            const startWr = winrates[0] || 0.5;
            const endWr = winrates[end - 1] || 0.5;
            item.addWinrate(startWr, endWr);
          }
          heap.push(item);
          seenHashes.set(prefixHash, item);
          prefixProcessed += 1;
        } else {
          const min = heap.min;
          if (min && estCount > min.count) {
            const newItem = new HeapItem(estCount, prefix, direction, prefixHash);
            if (winrates.length >= end) {
              const startWr = winrates[0] || 0.5;
              const endWr = winrates[end - 1] || 0.5;
              newItem.addWinrate(startWr, endWr);
            }
            const oldItem = heap.replaceMin(newItem);
            if (oldItem) {
              seenHashes.delete(oldItem.prefixHash);
            }
            seenHashes.set(prefixHash, newItem);
            prefixProcessed += 1;
          }
        }
      }
      
      processedSeq += 1;
      if (processedSeq % 1000 === 0) {
        console.log(`  处理: ${processedSeq}定式/${prefixProcessed}前缀, 单链跳过: ${skippedSingleChain}`);
      }
    }
    
    console.log(`\n  堆中候选: ${heap.size} 个, 单链跳过: ${skippedSingleChain} 个`);
    
    // Phase 3: 排序和转换
    console.log('\n🔄 Phase 4: 排序和入库...');
    
    const candidates = heap.toArray();
    const totalSeq = Math.max(this.sequences.length, 1);
    const josekiList: JosekiItem[] = [];
    
    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i]!;
      const moves = item.prefix.split(' ');
      
      if (moves.length > maxMoves) continue;
      
      const joseki: JosekiItem = {
        id: `kj_${i + 1}:05d}`,
        source: 'katago',
        moves: moves,
        frequency: item.count,
        probability: Math.round((item.count / totalSeq) * 1000000) / 1000000,
        createdAt: new Date().toISOString(),
      };
      
      const winrateStats = item.getWinrateStats();
      if (winrateStats) {
        joseki.winrateStats = winrateStats;
      }
      
      josekiList.push(joseki);
    }
    
    console.log(`✅ 构建完成: ${josekiList.length} 条定式`);
    
    return josekiList;
  }
  
  /**
   * 获取统计信息
   */
  getStats(): { totalSequences: number; cmsSize: number } {
    return {
      totalSequences: this.sequences.length,
      cmsSize: this.cms.getSize(),
    };
  }
}
