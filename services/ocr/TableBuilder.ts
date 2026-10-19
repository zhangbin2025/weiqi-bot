/**
 * 表格重建器 - 纯逻辑
 * @module services/ocr/TableBuilder
 *
 * 把 OCR 出的散乱文本块重建成行列网格。
 * 不依赖 DOM、不依赖引擎，可在 Node 环境直接单测。
 *
 * 两个核心步骤：
 *   1. 行聚类：按 y 坐标把文本块归到同一行（容差自适应行高）
 *   2. 列切分：统计所有文本块的 x 投影，在「没有文本覆盖」的空白带切分
 */

import type { ColumnRange, OcrItem, TableCell, TableGrid } from './types';
import { ocrDebug, ocrDebugLazy } from './OcrDebug';

/** 行聚类选项 */
export interface RowClusterOptions {
  /**
   * 行容差：两个文本块 y 差小于该值视为同一行。
   * 传 null 时自动按「最常见的相邻行距」推算。
   */
  yTolerance?: number | null;
}

/**
 * 推断行容差
 *
 * 行内 y 抖动（同一行不同列）远小于行间距，差值序列呈双峰。
 * 这里找排序后差值序列的**最大断裂点**，取两侧均值作为容差，
 * 从而把「抖动」和「行距」分开——比取中位数稳健（中位数会落在抖动峰上）。
 *
 * 实测（509×1955 对阵表，348 块）：差值分布为 1~6（行内）与 32~41（行间），
 * 中位数取到 1 导致容差被严重低估；本方法取到 19~35，行聚类稳定得到 43 行。
 */
export function inferRowTolerance(items: OcrItem[]): number {
  const ys = [...new Set(items.map((i) => i.y))].sort((a, b) => a - b);
  if (ys.length < 3) return 18;

  const diffs: number[] = [];
  for (let i = 1; i < ys.length; i++) diffs.push(ys[i]! - ys[i - 1]!);
  diffs.sort((a, b) => a - b);

  // 找「显著相对跳变」：不仅是绝对差最大，还要求后值显著大于前值。
  //
  // 不能用「绝对跳变最大」：实测该样本差值分布为 1~6（行内抖动）、
  // 32~41（行距）、57（标题到表头的大间距），最大绝对跳变出现在 41→57，
  // 会把容差推到 49，导致多行被并成一行（47 行 → 23 行）。
  // 真正要找的断裂是 6→15（抖动峰与行距峰之间）。
  let breakAt = -1;
  for (let i = 1; i < diffs.length; i++) {
    const lo = diffs[i - 1]!;
    const hi = diffs[i]!;
    if (lo > 0 && hi > lo * 2 && hi - lo >= 3) {
      breakAt = i;
      break;
    }
  }

  // 没找到明显断裂：说明行距和抖动接近，用最大差值的一半
  if (breakAt < 0) {
    const maxDiff = diffs[diffs.length - 1] ?? 18;
    return Math.min(60, Math.max(6, maxDiff * 0.5));
  }

  const lo = diffs[breakAt - 1]!;
  const hi = diffs[breakAt]!;
  return Math.min(60, Math.max(6, (lo + hi) / 2));
}

/**
 * 按 y 坐标聚类成行
 * @returns 每行的文本块数组，行按 y 升序
 */
export function clusterRows(items: OcrItem[], options: RowClusterOptions = {}): OcrItem[][] {
  if (items.length === 0) return [];

  const tol = options.yTolerance ?? inferRowTolerance(items);
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);

  const rows: OcrItem[][] = [];
  let cur: OcrItem[] = [sorted[0]!];
  // 用已加入块的 y 均值作为行代表值，比用首个块更稳
  let anchorY = sorted[0]!.y;

  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i]!;
    if (Math.abs(it.y - anchorY) <= tol) {
      cur.push(it);
      anchorY = cur.reduce((s, c) => s + c.y, 0) / cur.length;
    } else {
      rows.push(cur);
      cur = [it];
      anchorY = it.y;
    }
  }
  if (cur.length) rows.push(cur);

  for (const r of rows) r.sort((a, b) => a.x - b.x);
  return rows;
}

/**
 * 检测列边界
 *
 * 思路：对文本块的**中心 x** 做单链聚类，相邻簇的中点即为列分界。
 *
 * 为什么不用「x 投影直方图找空白带」：
 *   实测（2026-10-19，509×1955 对阵表，348 个文本块）横向投影几乎
 *   不存在全空的列间隙——只有 1px 和 1px 两处空隙，检测框彼此重叠。
 *   该图用直方图法会得到单一列，完全失败。
 *   改用中心聚类后，阈值在 8~30px 区间内稳定得到 8 个簇（即 8 列），
 *   对阈值不敏感，鲁棒性远好于投影法。
 *
 * @param gap 同一列内相邻中心 x 的最大间距，超过则视为新列
 */
export function detectColumns(items: OcrItem[], gap = 20): ColumnRange[] {
  if (items.length === 0) return [];

  const centers = items.map((i) => i.x + i.w / 2).sort((a, b) => a - b);

  // 单链聚类
  const clusters: number[][] = [[centers[0]!]];
  for (let i = 1; i < centers.length; i++) {
    const v = centers[i]!;
    const last = clusters[clusters.length - 1]!;
    if (v - last[last.length - 1]! <= gap) last.push(v);
    else clusters.push([v]);
  }

  // 相邻簇之间的中点作为分界
  const cuts: number[] = [];
  for (let i = 0; i < clusters.length - 1; i++) {
    const cur = clusters[i]!;
    const next = clusters[i + 1]!;
    cuts.push((cur[cur.length - 1]! + next[0]!) / 2);
  }

  const ranges: ColumnRange[] = [];
  let start = -Infinity;
  for (let i = 0; i < cuts.length; i++) {
    ranges.push({ index: i, start, end: cuts[i]! });
    start = cuts[i]!;
  }
  ranges.push({ index: cuts.length, start, end: Infinity });

  return ranges;
}

/**
 * 判断文本块落在哪一列
 * 用块中心 x 判断，比用左边界更抗干扰（检测框常有偏移）
 */
export function columnOf(item: OcrItem, columns: ColumnRange[]): number | null {
  const cx = item.x + item.w / 2;
  for (const c of columns) {
    if (cx >= c.start && cx < c.end) return c.index;
  }
  // 中心落在空隙里时，退化为「最近列」
  let best: number | null = null;
  let bestDist = Infinity;
  for (const c of columns) {
    const cc = (c.start + c.end) / 2;
    const d = Math.abs(cx - cc);
    if (d < bestDist) {
      bestDist = d;
      best = c.index;
    }
  }
  return best;
}

/**
 * 重建表格网格
 *
 * 关键一步：列聚类前先剔除「非数据行」（大标题、表头）。
 * 实测：标题「2026年浦东新区围棋锦标赛」横跨 321px，
 * 若参与列聚类会把第 5 列切成两半（8 列 → 9 列）。
 * 判据：每行的文本块数量，明显少于众数的行即为非数据行。
 *
 * @param items OCR 文本块（坐标须为原始图片尺度）
 * @param options 行容差、列聚类间距
 */
export function buildTable(items: OcrItem[], options: RowClusterOptions & { minGap?: number } = {}): TableGrid {
  const rows = clusterRows(items, options);

  // 众数行数 = 数据行的列数
  const counts = rows.map((r) => r.length);
  const freq = new Map<number, number>();
  for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
  let modal = counts[0] ?? 1;
  let modalFreq = 0;
  for (const [c, f] of freq) {
    if (f > modalFreq || (f === modalFreq && c > modal)) {
      modal = c;
      modalFreq = f;
    }
  }

  const dataRows = rows.filter((r) => r.length >= modal * 0.6);
  const forColumns = dataRows.length > 0 ? dataRows.flat() : items;
  const columns = detectColumns(forColumns, options.minGap ?? 20);

  const cells: TableCell[] = [];
  rows.forEach((rowItems, row) => {
    // 同一单元格内的所有块都要保留，按 x 从左到右拼成一个整体：
    //   早期版本「每列只保留置信度最高的块」，实测把同一格里的
    //   '郭'(x=248-272) 和 '晖'(x=285-310) 丢掉一个 → 输出单字名 '郭'。
    //   推断「哪两个块属于同一格」不该靠置信度，单元格本身就是容器。
    const byCol = new Map<number, OcrItem[]>();
    for (const it of rowItems) {
      const col = columnOf(it, columns);
      if (col === null) continue;
      const list = byCol.get(col);
      if (list) list.push(it);
      else byCol.set(col, [it]);
    }
    for (const [col, list] of byCol) {
      ocrDebugLazy('buildTable.cell', () => {
        if (list.length > 1) {
          return {
            row,
            col,
            拼接: list
              .slice()
              .sort((a, b) => a.x - b.x)
              .map((it) => `${it.text}@x${Math.round(it.x)}-${Math.round(it.x + it.w)}`),
          };
        }
        return null;
      });
      // 按 x 排序拼接：顺带修正检测框左右颠倒（实测 '崇' 在 '王' 之前）
      list.sort((a, b) => a.x - b.x);
      const text = list
        .map((it) => it.text.trim())
        .filter(Boolean)
        .join('');
      if (!text) continue;
      // 拼接结果的可信度取最低者：任一块认错，整体就不该被信任
      const score = Math.min(...list.map((it) => it.score));
      cells.push({ row, col, text, score });
    }
  });

  cells.sort((a, b) => a.row - b.row || a.col - b.col);
  return {
    cells,
    rowCount: rows.length,
    columnCount: columns.length,
    columns,
  };
}

/** 取某行某列的文本 */
export function cellText(grid: TableGrid, row: number, col: number): string {
  return grid.cells.find((c) => c.row === row && c.col === col)?.text ?? '';
}

/** 取某一行的所有文本（按列序） */
export function rowTexts(grid: TableGrid, row: number): string[] {
  return grid.columns.map((c) => cellText(grid, row, c.index));
}
