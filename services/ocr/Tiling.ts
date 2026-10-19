/**
 * 长图分片识别与碎片合并 - 纯逻辑
 * @module services/ocr/Tiling
 *
 * 为什么必须分片（2026-10-19 实测，771×6038 对阵表）：
 *   PaddleOCR 检测模型的默认参数是 resizeLong=960 / limitType="max"，
 *   即「把长边缩到 960」。整图 6038px 高 → scale = 960/6038 = 0.159，
 *   检测输入实际只有 123×960，表格里 24px 高的字被压到约 4px。
 *
 *   后果有两个，同源：
 *     ① 顶部 y<1889 整片漏检（比赛名称就在这一段，所以「没提取对」，
 *        实际是根本没被检测到）
 *     ② 单字名被拆成两个框，且互相重叠、顺序颠倒：
 *          y=3140  '孙' x=[506,541] w=35
 *          y=3140  '超' x=[527,580] w=53   ← 与'孙'重叠 14px
 *        同理 '闻'(y=4048)、'王'+'崇'(y=5224)。169 个名字块里只有 5 个单字块，
 *        就是这三个人 —— 不是「认错字」，是检测阶段框错了。
 *
 *   决定性验证：把图切成 ≤1900px 的段单独跑，
 *     顶部段 → 429 块，比赛名称完整出来；
 *     y2900-3400 段 → '孙超' 合并成一个块，score=1.00。
 *
 *   注意：单纯调大 limitSideLen 无效（实测 lsl=1920 结果完全不变），
 *   因为瓶颈是 maxSideLimit 钳制 + maxCandidates(1000) 截断，
 *   后者库里未暴露，只能靠分片绕开。
 *
 * 本模块不依赖 DOM / 引擎，可在 Node 环境直接单测。
 */

import type { OcrItem } from './types';

/** 一片（tile）的纵向范围，坐标为**放大后 canvas 的像素** */
export interface TileBand {
  /** 起始 y（含） */
  y0: number;
  /** 结束 y（不含） */
  y1: number;
}

/**
 * 规划分片
 *
 * 相邻片之间留重叠，避免正好把某一行文字切成上下两半。
 *
 * @param height 图片总高（canvas 像素）
 * @param tileHeight 单片高度
 * @param overlap 相邻片重叠高度
 */
export function planTiles(height: number, tileHeight: number, overlap: number): TileBand[] {
  if (height <= 0) return [];
  const th = Math.max(1, Math.floor(tileHeight));
  if (height <= th) return [{ y0: 0, y1: height }];

  const ov = Math.max(0, Math.min(Math.floor(overlap), Math.floor(th / 2)));
  const step = th - ov;
  const bands: TileBand[] = [];
  for (let y0 = 0; y0 < height; y0 += step) {
    const y1 = Math.min(height, y0 + th);
    bands.push({ y0, y1 });
    if (y1 >= height) break;
  }
  return bands;
}

/** 两个框的相交面积 / 并面积 */
export function iou(a: OcrItem, b: OcrItem): number {
  const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (ix <= 0 || iy <= 0) return 0;
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** 块中心 */
function center(it: OcrItem): { cx: number; cy: number } {
  return { cx: it.x + it.w / 2, cy: it.y + it.h / 2 };
}

/**
 * 去重：相邻片重叠区会把同一处文字识别两次
 *
 * 判据：文本相同 且 位置几乎重合（IoU 超过阈值，或中心距小于半高）。
 * 同一张表里相同的文字（如大量 '0'、'代表队'）纵向相距很远，不会被误删。
 *
 * @returns 去重后的块（保留置信度更高的那个），顺序与输入一致
 */
export function dedupeItems(items: OcrItem[], iouThreshold = 0.5): OcrItem[] {
  const kept: OcrItem[] = [];
  for (const it of items) {
    let dupIdx = -1;
    for (let i = 0; i < kept.length; i++) {
      const k = kept[i]!;
      if (k.text !== it.text) continue;
      if (iou(k, it) >= iouThreshold) {
        dupIdx = i;
        break;
      }
      const a = center(k);
      const b = center(it);
      const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      if (dist <= 0.5 * Math.max(k.h, it.h)) {
        dupIdx = i;
        break;
      }
    }
    if (dupIdx < 0) {
      kept.push(it);
    } else if (it.score > kept[dupIdx]!.score) {
      kept[dupIdx] = it;
    }
  }
  return kept;
}

/** 碎片合并参数 */
export interface MergeOptions {
  /**
   * 同一行的判定：垂直中心差 / 较大高度，不超过该值
   * 实测：被拆的单字名约 0.0~0.1；跨两行的单位名（'台州市总工会'+'代表队'）
   *       为 0.70~0.89。取 0.4 有充足余量。
   */
  maxDyRatio?: number;
  /**
   * 水平重叠量（像素）至少为该值才考虑合并。
   * 实测：正常相邻列的间隙是 +3px 起（正数=有间隙）；
   *       被拆的碎片是 -12~-14px（负数=重叠）。要求 >0 可天然排除正常列。
   */
  minOverlap?: number;
  /**
   * 单个碎片的最大宽高比。超过说明是正常的多字词（如 6 字单位名 w/h≈3.9），
   * 不该参与合并。实测单字碎片 w/h 为 1.06~1.47。
   */
  maxFragRatio?: number;
  /** 合并后的最大宽高比，兜底防误并 */
  maxMergedRatio?: number;
}

/**
 * 合并被拆开的文字碎片（如 '孙'+'超' → '孙超'）
 *
 * 必须同时满足四个条件才会合并，实测能干净区分：
 *   ① 同一行（垂直中心差 / 高度 ≤ 0.4）
 *   ② 水平方向咬合（允许 8px 内间隙）——配合短块判据共同排除正常列
 *   ③ 两侧都是短碎片（w/h ≤ 2.2）——排除多字单位名
 *   ④ 合并后宽高比合理（≤ 3.5）
 *
 * 只合并相邻的一对，不链式扩散，避免把整行粘成一团。
 */
export function mergeFragments(items: OcrItem[], options: MergeOptions = {}): OcrItem[] {
  const maxDyRatio = options.maxDyRatio ?? 0.4;
  const minOverlap = options.minOverlap ?? -8;
  const maxFragRatio = options.maxFragRatio ?? 2.2;
  const maxMergedRatio = options.maxMergedRatio ?? 3.5;

  if (items.length < 2) return [...items];

  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const merged = new Set<number>();
  const out: OcrItem[] = [];

  for (let i = 0; i < sorted.length; i++) {
    if (merged.has(i)) continue;
    const a = sorted[i]!;
    let partner = -1;

    for (let j = i + 1; j < sorted.length; j++) {
      if (merged.has(j)) continue;
      const b = sorted[j]!;

      const hRef = Math.max(a.h, b.h);
      if (hRef <= 0) continue;

      // ① 同一行
      const ca = center(a);
      const cb = center(b);
      if (Math.abs(ca.cy - cb.cy) / hRef > maxDyRatio) continue;

      // 保证 a 在左，便于算水平关系
      const left = a.x <= b.x ? a : b;
      const right = a.x <= b.x ? b : a;

      // ② 水平重叠（负数间隙 = 重叠）
      const overlap = left.x + left.w - right.x;
      if (overlap < minOverlap) continue;

      // ③ 两侧都是短碎片
      if (a.w / a.h > maxFragRatio || b.w / b.h > maxFragRatio) continue;

      // ④ 合并后不失真
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x + a.w, b.x + b.w);
      if ((x1 - x0) / hRef > maxMergedRatio) continue;

      partner = j;
      break;
    }

    if (partner < 0) {
      out.push(a);
      continue;
    }

    const b = sorted[partner]!;
    merged.add(partner);
    // 按 x 从左到右拼字：检测框可能颠倒（实测 '崇' 在 '王' 之前）
    const left = a.x <= b.x ? a : b;
    const right = a.x <= b.x ? b : a;
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const x1 = Math.max(a.x + a.w, b.x + b.w);
    const y1 = Math.max(a.y + a.h, b.y + b.h);

    out.push({
      text: left.text + right.text,
      // 合并结果的可信度取较低者：任一侧认错，整体就不该被信任
      score: Math.min(a.score, b.score),
      x: x0,
      y: y0,
      w: x1 - x0,
      h: y1 - y0,
    });
  }

  return out.sort((p, q) => p.y - q.y || p.x - q.x);
}

/**
 * 把分片识别的结果还原成整图坐标并净化
 *
 * @param batches 每片的 { y0, items }，items 坐标为「片内坐标」
 * @param scale 放大倍数（canvas / 原图），用于除回原始尺度
 */
export function mergeTileResults(
  batches: Array<{ y0: number; items: OcrItem[] }>,
  scale: number,
  options: MergeOptions = {}
): OcrItem[] {
  const all: OcrItem[] = [];
  for (const b of batches) {
    for (const it of b.items) {
      all.push({ ...it, y: it.y + b.y0 });
    }
  }
  const deduped = dedupeItems(all);
  const merged = mergeFragments(deduped, options);
  if (scale === 1) return merged;
  return merged.map((it) => ({
    ...it,
    x: it.x / scale,
    y: it.y / scale,
    w: it.w / scale,
    h: it.h / scale,
  }));
}
