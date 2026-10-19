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
import { ocrDebug, ocrDebugLazy, isOcrDebugEnabled } from './OcrDebug';

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
 * 判据（满足任一即视为重复）：
 *   ① 文本相同 且 位置几乎重合（IoU 超过阈值，或中心距小于半高）
 *   ② 空间被包含：小框面积的 80% 以上落在大框内，且同一行
 *
 * ② 是必需的：同一处文字被识别成两种结果时文本不同，① 失效。
 *   实测三种形态，都不是子串关系所以不能靠文本包含判断：
 *     '吕睿'(511-576) vs '睿'(539-574)      IoU=0.41  长度不同
 *     '陈思旷'(247-311) vs '陈忠旷'(249-301) IoU=0.52  等长、1 字之差
 *     '仲伟傑' vs '仲伟杰'                  IoU=0.68  异体字
 *   三者的小框包含率都是 1.0，靠空间包含可一并解决。
 *   不去重的话，拼接进单元格就成 '吕睿睿'、'陈思旷陈忠旷'。
 *
 * 同一张表里相同的文字（如大量 '0'、'代表队'）纵向相距很远，不会被误删。
 *
 * @returns 去重后的块（保留置信度更高的那个），顺序与输入一致
 */
export function dedupeItems(items: OcrItem[], iouThreshold = 0.5): OcrItem[] {
  const kept: OcrItem[] = [];
  // 与 kept[i] 对应：true = 走的是「空间包含」规则，应优先保留更长的文本
  const contained = new Array<boolean>(items.length).fill(false);
  for (const it of items) {
    let dupIdx = -1;
    for (let i = 0; i < kept.length; i++) {
      const k = kept[i]!;
      if (k.text === it.text) {
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
        continue;
      }
      // ② 空间包含 + 同一行（不要求文本有包含关系，见上方注释）
      const short = k.w * k.h <= it.w * it.h ? k : it;
      const long = short === k ? it : k;
      const ix = Math.min(short.x + short.w, long.x + long.w) - Math.max(short.x, long.x);
      const iy = Math.min(short.y + short.h, long.y + long.h) - Math.max(short.y, long.y);
      if (ix <= 0 || iy <= 0) continue;
      if (short.w <= 0 || short.h <= 0) continue;
      if (ix * iy / (short.w * short.h) < 0.8) continue;
      const sc = center(short);
      const lc = center(long);
      if (Math.abs(sc.cy - lc.cy) > 0.5 * Math.max(short.h, long.h)) continue;
      dupIdx = i;
      contained[dupIdx] = true;
      break;
    }
    if (dupIdx < 0) {
      kept.push(it);
      contained[kept.length - 1] = false;
      continue;
    }
    // 空间包含时优先保留「更完整」的那个：'吕睿'(0.91) 比 '睿'(1.00)
    // 多一个字，虽然置信度低但信息更全 —— 置信度高的短块往往是长块的一部分。
    // 等长时才比置信度（如 '陈思旷' vs '陈忠旷'）。
    const cur = kept[dupIdx]!;
    const better = contained[dupIdx]
      ? it.text.length > cur.text.length ||
        (it.text.length === cur.text.length && it.score > cur.score)
      : it.score > cur.score;

    // 「某个字莫名消失」时首先看这里：两个块被判定为重复，其中一个被丢掉。
    // 实测 '田源' 只剩 '田' 就属于此类 —— 重叠区把同一处识别成两次，
    // 保留了置信度更高的短块，长的反而被顶掉。
    ocrDebugLazy('dedupe.drop', () => ({
      保留: cur.text,
      丢弃: it.text,
      保留更长: better,
      判据: contained[dupIdx] ? '空间包含' : '同文本+IoU',
      s保留: +cur.score.toFixed(3),
      s丢弃: +it.score.toFixed(3),
      y: Math.round(it.y),
      x: `${Math.round(it.x)}-${Math.round(it.x + it.w)}`,
    }));

    if (better) {
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
  const dbgOn = isOcrDebugEnabled();
  // 记录「差一点就能合并」的样本：排查漏合并时看这个，比翻全部块快得多
  const nearMiss: Array<{ a: string; b: string; reason: string }> = [];
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

      const ca = center(a);
      const cb = center(b);
      const dyRatio = Math.abs(ca.cy - cb.cy) / hRef;

      // 保证 a 在左，便于算水平关系
      const left = a.x <= b.x ? a : b;
      const right = a.x <= b.x ? b : a;
      const overlap = left.x + left.w - right.x;
      const mergedRatio =
        (Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x)) / hRef;

      // 「差一点就合并」：同一行且水平够近（间隙 ≤ 20px），但被某个条件否掉。
      // 这类样本是「某字莫名消失」的第一嫌疑 —— 实测 '田源' 只剩 '田' 即属此类。
      if (dbgOn && dyRatio <= maxDyRatio && overlap >= -20) {
        let reason = '';
        if (overlap < minOverlap)
          reason = `②间隙过大(gap=${(-overlap).toFixed(0)}px>${-minOverlap})`;
        else if (a.w / a.h > maxFragRatio || b.w / b.h > maxFragRatio)
          reason = `③非短块(w/h=${(a.w / a.h).toFixed(2)}/${(b.w / b.h).toFixed(2)}>${maxFragRatio})`;
        else if (mergedRatio > maxMergedRatio)
          reason = `④合并后过宽(w/h=${mergedRatio.toFixed(2)}>${maxMergedRatio})`;
        if (reason) nearMiss.push({ a: a.text, b: b.text, reason });
      }

      // ① 同一行
      if (dyRatio > maxDyRatio) continue;

      // ② 水平重叠（负数间隙 = 重叠）
      if (overlap < minOverlap) continue;

      // ③ 两侧都是短碎片
      if (a.w / a.h > maxFragRatio || b.w / b.h > maxFragRatio) continue;

      // ④ 合并后不失真
      if (mergedRatio > maxMergedRatio) continue;

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

    ocrDebugLazy('merge.done', () => ({
      结果: left.text + right.text,
      来自: `${a.text}+${b.text}`,
      y: Math.round(y0),
      x: `${Math.round(x0)}-${Math.round(x1)}`,
    }));

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

  if (dbgOn) {
    ocrDebug('merge.nearMiss', {
      数量: nearMiss.length,
      样本: nearMiss.slice(0, 60),
    });
  }

  return out.sort((p, q) => p.y - q.y || p.x - q.x);
}

/**
 * 把分片识别的结果还原成整图坐标并净化
 *
 * ⚠️ 坐标系约定（实测踩过的坑）：
 *   - `batches[].y0` 由 `planTiles(canvas.height, ...)` 产出，是**放大后 canvas 坐标**
 *   - `batches[].items` 由 `toItems(raw, scale)` 产出，**已经除过 scale**，是原图坐标
 *
 *   于是本函数只需处理 y0 的换算：**把 y0 除以 scale 后相加即可，不能再除一遍**。
 *
 *   两个 bug（实测 0.png，771×6038，宽<1200 → scale=2）：
 *     ① `y: it.y + b.y0` 直接相加（canvas 坐标 + 原图坐标）
 *     ② 末尾又对 x/y/w/h 统一 `/scale`（toItems 已除过 → 二次除）
 *   ② 是均匀缩放，短图（y0=0）看不出问题，只是坐标整体小一倍；
 *   但①+② 叠加在长图上，各片偏移量被错误放大且不一致 → 行聚类彻底错乱。
 *
 *   单测之所以全绿：fixture 是「已还原好的整图坐标」，绕开了这条路径。**引以为戒。**
 *
 * @param batches 每片的 { y0, items }；y0 为 canvas 坐标，items 为原图坐标
 * @param scale 放大倍数（canvas / 原图）
 */
export function mergeTileResults(
  batches: Array<{ y0: number; items: OcrItem[] }>,
  scale: number,
  options: MergeOptions = {}
): OcrItem[] {
  const inv = scale === 1 ? 1 : 1 / scale;
  const all: OcrItem[] = [];
  for (const b of batches) {
    const y0 = b.y0 * inv;
    for (const it of b.items) {
      all.push({ ...it, y: it.y + y0 });
    }
  }

  ocrDebugLazy('tiling.summary', () => ({
    片数: batches.length,
    scale,
    每片块数: batches.map((b) => b.items.length),
    y0原图: batches.map((b) => Math.round(b.y0 * inv)),
    合计: all.length,
  }));

  const deduped = dedupeItems(all);
  const merged = mergeFragments(deduped, options);

  ocrDebugLazy('tiling.after', () => ({
    去重: `${all.length} → ${deduped.length}`,
    合并: `${deduped.length} → ${merged.length}`,
  }));

  return merged;
}
