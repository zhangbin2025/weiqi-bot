/**
 * 定式库构建器 - Domain 层核心算法
 * 对应 Python: weiqi-joseki/src/builder/katago_builder.py
 *
 * 核心流程：
 * 1. Phase 1: CMS 统计频率
 * 2. Phase 2-3: 逆向遍历 + 单链检测 + 小顶堆选 top-k
 * 3. Phase 4: 排序入库
 *
 * 支持内存模式（addSequence）和流式模式（buildFromTempData）
 */

import { CountMinSketch } from "../../utils/CMS.js";
import { HeapItem, MinHeap } from "./JosekiHeap.js";

/** 单链检测阈值 */
const SINGLE_CHAIN_THRESHOLD = 0.05;

/** 有效第一手坐标（右上角 ruld 视角） */
const VALID_FIRST_MOVES = new Set([
  "pd", "qc", "pc", "oe", "oc", "nc", "od", "nd", "ne", "me",
]);

/** 定式数据 */
export interface JosekiItem {
  id: string;
  source: string;
  moves: string[];
  frequency: number;
  probability: number;
  winrateStats?: Record<string, unknown>;
  createdAt: string;
}

/** 构建配置 */
export interface BuildConfig {
  minFreq?: number;
  topK?: number;
  minMoves?: number;
  maxMoves?: number;
  cmsWidth?: number;
  cmsDepth?: number;
}

/** 序列数据 */
export interface SequenceData {
  stdCoords: string[];
  winrates: number[];
  firstColor: string;
}

/** 临时文件行数据 */
export interface TempLine {
  direction: string;
  coords: string[];
  winrates: number[];
  firstColor: string;
}

/** 重导出 */
export { HeapItem, MinHeap } from "./JosekiHeap.js";

/**
 * 定式库构建器
 */
export class JosekiBuilder {
  private cms: CountMinSketch;
  private sequences: SequenceData[] = [];

  constructor(config: Partial<BuildConfig> = {}) {
    this.cms = new CountMinSketch(
      config.cmsWidth ?? 4194304,
      config.cmsDepth ?? 4
    );
  }

  getCMS(): CountMinSketch { return this.cms; }
  setCMS(cms: CountMinSketch): void { this.cms = cms; }

  /** 添加序列到构建器（内存模式） */
  addSequence(data: SequenceData): void {
    if (data.stdCoords.length < 4) return;
    if (!VALID_FIRST_MOVES.has(data.stdCoords[0]!)) return;
    this.sequences.push(data);
    for (let len = 2; len <= data.stdCoords.length; len++) {
      this.cms.update(data.stdCoords.slice(0, len).join(" "), 1);
    }
  }

  /**
   * 从临时数据流式构建（auto 模式）
   * tempLines 从临时文件逐行读取
   */
  buildFromTempData(
    tempLines: Iterable<TempLine>,
    cms: CountMinSketch,
    config: Partial<BuildConfig> = {},
    totalSequences: number = 0
  ): JosekiItem[] {
    const minFreq = config.minFreq ?? 5;
    const topK = config.topK ?? 10000;
    const minMoves = config.minMoves ?? 4;
    const maxMoves = config.maxMoves ?? 50;

    const heap = new MinHeap(topK);
    const seenHashes = new Map<string, HeapItem>();

    for (const line of tempLines) {
      const seqParts = line.coords;
      const winrates = line.winrates;
      if (seqParts.length < minMoves) continue;

      let lastCount = Infinity;
      for (let end = seqParts.length; end >= minMoves; end--) {
        const prefixParts = seqParts.slice(0, end);
        const prefix = prefixParts.join(" ");
        const estCount = cms.estimate(prefix);
        if (estCount < minFreq) {
          lastCount = estCount;
          continue;
        }
        const prefixHash = prefix;
        if (lastCount !== Infinity) {
          const ratio = Math.abs(estCount - lastCount) / Math.max(estCount, lastCount, 1);
          if (ratio < SINGLE_CHAIN_THRESHOLD) {
            lastCount = estCount;
            continue;
          }
        }
        lastCount = estCount;

        if (seenHashes.has(prefixHash)) {
          const item = seenHashes.get(prefixHash)!;
          if (winrates.length >= end)
            item.addWinrate(winrates[0] ?? 0.5, winrates[end - 1] ?? 0.5);
          continue;
        }

        if (heap.size < topK) {
          const item = new HeapItem(estCount, prefix, line.direction, prefixHash);
          if (winrates.length >= end)
            item.addWinrate(winrates[0] ?? 0.5, winrates[end - 1] ?? 0.5);
          heap.push(item);
          seenHashes.set(prefixHash, item);
        } else {
          const minItem = heap.min;
          if (minItem && estCount > minItem.count) {
            const newItem = new HeapItem(estCount, prefix, line.direction, prefixHash);
            if (winrates.length >= end)
              newItem.addWinrate(winrates[0] ?? 0.5, winrates[end - 1] ?? 0.5);
            const old = heap.replaceMin(newItem);
            if (old) seenHashes.delete(old.prefixHash);
            seenHashes.set(prefixHash, newItem);
          }
        }
      }
    }

    // Phase 4: 排序和入库
    const candidates = heap.toArray();
    const totalSeq = Math.max(totalSequences || this.sequences.length, 1);
    const josekiList: JosekiItem[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i]!;
      const moves = item.prefix.split(" ");
      if (moves.length > maxMoves) continue;
      const joseki: JosekiItem = {
        id: `kj_${String(i + 1).padStart(5, "0")}`,
        source: "katago",
        moves,
        frequency: item.count,
        probability: Math.round((item.count / totalSeq) * 1e6) / 1e6,
        createdAt: new Date().toISOString(),
      };
      const wr = item.getWinrateStats();
      if (wr) joseki.winrateStats = wr;
      josekiList.push(joseki);
    }
    return josekiList;
  }

  /** 内存模式构建 */
  build(config: Partial<BuildConfig> = {}): JosekiItem[] {
    for (const seq of this.sequences) {
      for (let len = 2; len <= seq.stdCoords.length; len++) {
        this.cms.update(seq.stdCoords.slice(0, len).join(" "), 1);
      }
    }
    const tempLines: TempLine[] = this.sequences.map((s) => ({
      direction: "ruld",
      coords: s.stdCoords,
      winrates: s.winrates,
      firstColor: s.firstColor,
    }));
    return this.buildFromTempData(tempLines, this.cms, config, this.sequences.length);
  }

  getStats(): { totalSequences: number; cmsSize: number } {
    return { totalSequences: this.sequences.length, cmsSize: this.cms.getSize() };
  }
}
