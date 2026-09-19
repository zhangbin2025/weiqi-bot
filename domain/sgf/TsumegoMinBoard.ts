/**
 * 死活题最小路数转换（公共模块）
 * @module domain/sgf/TsumegoMinBoard
 * @description
 *  针对「抓取的是 19 路棋谱、但死活题只落在局部」的场景：
 *  把整张 SGF 的棋子（含【所有分支变化图】的着法）截取成以 (0,0) 为原点、
 *  紧贴原棋盘对应角落/边缘的「最小标准路数」小棋盘（9/13/19）。
 *
 *  两个关键正确性保证：
 *  1) 【全树扫描】包围盒覆盖整棵 SGF 树——包括所有变化分支里的着法/摆子/标记，
 *     避免「主分支在小局部、某变化分支却落到远处」导致压缩后坐标越界。
 *  2) 【转换后自校验】重映射完成后重新解析产物，逐点检查所有坐标都在
 *     [0, newSize-1] 内；只要有一点越界，就放弃压缩、回退原 SGF（绝不产出坏棋谱）。
 *
 *  裁剪必须【贴原棋盘边缘】，而不是以棋子包围盒居中。
 *  角部/边部死活题（如右上角、右侧一路线）总有一边贴着原棋盘边界，
 *  用该边界对齐，才能保证死活题仍落在小棋盘的同一角/边。
 *
 *  触发条件沿用既有逻辑：存在 AB/AW 摆子（move=0 死活题）且局部明显小于全盘。
 */

import { SGFParser, coordToPos } from './SGFParser';
import type { ISGFNode, SGFPropValue } from './types';

export interface TsumegoMinBoardResult {
  /** 重映射后的标准路数（9 | 13 | 19） */
  size: 9 | 13 | 19;
  /** 改写后的小棋盘 SGF（保留分支，含新 SZ / 新 AB[AW] / 新着法坐标） */
  sgf: string;
  /** 局部框（原 19 路坐标系） */
  viewBox: { minX: number; minY: number; width: number; height: number };
  /** 原坐标 → 小棋盘坐标的偏移（newX = x - origin.x） */
  origin: { x: number; y: number };
}

export interface TsumegoMinBoardOptions {
  /** 包围盒四边留白（原棋盘格数），默认 1；用于保留贴边空线，避免贴边棋子被挤到边界内 */
  margin?: number;
  /** 原棋盘达到该路数以上才尝试压缩，默认 13 */
  minOriginalSize?: number;
}

/**
 * 需要「整树扫描 + 平移 + 校验」的坐标型属性（每个值都是一个坐标点）。
 * 覆盖：摆子(AB/AW)、清子(AE)、着法(B/W)、标记(TR/SQ/CR/MA/SL)、
 * 领地(DD/TB/TW)。LB 的值为 `坐标:文字`，单独处理。
 */
const POINT_PROPS = [
  'AB', 'AW', 'AE',
  'B', 'W',
  'TR', 'SQ', 'CR', 'MA', 'SL',
  'DD', 'TB', 'TW',
] as const;

/** 标签属性（值形如 `aa:文字`），需拆出坐标部分单独平移 */
const LABEL_PROPS = ['LB'] as const;

/** 视口属性（值引用原盘坐标，裁剪后已无意义）——转换时直接丢弃 */
const DROP_PROPS = ['VW'] as const;

/** 向上取整到标准路数 */
function roundUpToStandard(n: number): 9 | 13 | 19 {
  if (n <= 9) return 9;
  if (n <= 13) return 13;
  return 19;
}

/** 取属性值的字符串数组 */
function propList(raw: SGFPropValue | undefined): string[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw.map(String);
  return [String(raw)];
}

/** 从 LB 值 `aa:文字` 中拆出坐标（无冒号则整体视作坐标） */
function labelCoord(v: string): string {
  const i = v.indexOf(':');
  return i >= 0 ? v.slice(0, i) : v;
}

/** 判定一个坐标字符串是否携带合法盘面坐标（排除 pass: ''、'tt'） */
function hasPoint(coord: string): boolean {
  if (!coord || coord === 'tt' || coord === 'TT') return false;
  return coordToPos(coord) !== null;
}

/** 对单个节点：返回其中出现的所有坐标点（用于包围盒与校验） */
function nodePoints(node: ISGFNode): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const props = node.properties;
  for (const key of POINT_PROPS) {
    if (props[key] === undefined) continue;
    for (const c of propList(props[key])) {
      if (!hasPoint(c)) continue;
      const p = coordToPos(c);
      if (p) out.push(p);
    }
  }
  for (const key of LABEL_PROPS) {
    if (props[key] === undefined) continue;
    for (const v of propList(props[key])) {
      const c = labelCoord(v);
      if (!hasPoint(c)) continue;
      const p = coordToPos(c);
      if (p) out.push(p);
    }
  }
  // 兜底：某些解析器只在 node.coord / node.color 上挂着着法
  if (node.color && node.coord && hasPoint(node.coord)) {
    const p = coordToPos(node.coord);
    if (p) out.push(p);
  }
  return out;
}

/** 递归收集整棵 SGF 树【所有分支】的坐标点 */
function collectAllCoords(node: ISGFNode, out: Array<{ x: number; y: number }>): void {
  for (const p of nodePoints(node)) out.push(p);
  for (const child of node.children) {
    collectAllCoords(child, out);
  }
}

/**
 * 平移单个坐标字符串。越界返回 null（调用方据此判断是否放弃压缩）。
 * pass（'' / 'tt'）原样返回。
 */
function shiftCoord(coord: string, origin: { x: number; y: number }, size: number): string | null {
  if (coord === 'tt' || coord === 'TT') return coord;
  const p = coordToPos(coord);
  if (!p) return coord; // 空 / pass
  const nx = p.x - origin.x;
  const ny = p.y - origin.y;
  if (nx < 0 || nx >= size || ny < 0 || ny >= size) return null;
  return String.fromCharCode(97 + nx) + String.fromCharCode(97 + ny);
}

/**
 * 就地平移整棵树的坐标（含所有分支）：
 *  - 根节点 SZ 改为新路数，丢弃 VW
 *  - POINT_PROPS / LABEL_PROPS 的坐标平移
 *  - 任意节点的 B/W 着法、AB/AW 摆子同样平移
 *
 * @returns 是否全部平移成功（有任何一点越界即返回 false）
 */
function remapTree(
  node: ISGFNode,
  origin: { x: number; y: number },
  size: number,
  isRoot: boolean
): boolean {
  const props = node.properties;
  let ok = true;

  if (isRoot) {
    props['SZ'] = [String(size)];
    for (const key of DROP_PROPS) delete props[key];
  }

  const shiftVal = (c: string): string => {
    const r = shiftCoord(c, origin, size);
    if (r === null) {
      ok = false;
      return c; // 保留原值，交由上层校验兜底
    }
    return r;
  };

  for (const key of POINT_PROPS) {
    if (props[key] === undefined) continue;
    props[key] = propList(props[key]).map(shiftVal);
  }
  for (const key of LABEL_PROPS) {
    if (props[key] === undefined) continue;
    props[key] = propList(props[key]).map(v => {
      const i = v.indexOf(':');
      if (i < 0) return shiftVal(v);
      return shiftVal(v.slice(0, i)) + v.slice(i);
    });
  }
  if (node.color && node.coord) {
    const r = shiftCoord(node.coord, origin, size);
    if (r !== null) node.coord = r;
    else ok = false;
  }

  for (const child of node.children) {
    if (!remapTree(child, origin, size, false)) ok = false;
  }
  return ok;
}

/**
 * 计算某个轴上的平移原点：
 *  优先贴原棋盘最近的边（保持死活题落在原角/原边），
 *  并夹取到「能容纳局部框」的合法范围内，保证包围盒内所有坐标都在小棋盘内。
 */
function computeOrigin(lo: number, hi: number, newSize: number, size: number): number {
  const distLow = lo;
  const distHigh = (size - 1) - hi;
  const desired = distHigh < distLow ? (size - newSize) : 0;

  const minOrigin = hi - (newSize - 1);
  const maxOrigin = lo;

  let o = desired;
  if (o > maxOrigin) o = maxOrigin;
  if (o < minOrigin) o = minOrigin;
  if (o < 0) o = 0;
  return o;
}

/** 转义 SGF 属性值中的 \ 和 ] */
function escapeSGF(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

/** 将节点属性序列化为 SGF 文本片段（KEY[v1][v2]...） */
function serializeProps(node: ISGFNode): string {
  let out = '';
  for (const key of Object.keys(node.properties)) {
    const values = propList(node.properties[key]);
    if (values.length === 0) continue;
    out += key;
    for (const v of values) {
      out += '[' + escapeSGF(v) + ']';
    }
  }
  return out;
}

/**
 * 忠实序列化整棵 SGF 树（保留属性、注释与全部分支）。
 *  - 单子节点：内联（;parent;child），保持主分支线性。
 *  - 多子节点：必须全部用括号分组（;parent(;c0..)(;c1..)），否则树结构错乱。
 */
function serializeTree(node: ISGFNode): string {
  let out = ';' + serializeProps(node);
  if (node.children.length === 1) {
    out += serializeTree(node.children[0]!);
  } else if (node.children.length > 1) {
    for (const child of node.children) {
      out += '(' + serializeTree(child) + ')';
    }
  }
  return out;
}

/**
 * 转换后校验：重新解析产物，逐点确认所有坐标都在 [0, size-1] 内。
 * 这是「绝不产出越界棋谱」的最后一道保险。
 */
function validateInRange(sgf: string, size: number): boolean {
  try {
    const parser = new SGFParser();
    const res = parser.parse(sgf);
    const tree = res.tree;
    if (!tree) return false;
    const pts: Array<{ x: number; y: number }> = [];
    collectAllCoords(tree, pts);
    for (const p of pts) {
      if (p.x < 0 || p.x >= size || p.y < 0 || p.y >= size) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 将 19 路（或 ≥ minOriginalSize 的路数）死活题 SGF
 * 转换为紧贴原棋盘边缘的最小标准路数 SGF。
 *
 * @returns 转换结果；若不满足压缩条件（已是小棋盘 / 无摆子 / 局部未明显小于全盘 /
 *          任何点无法落入小棋盘）返回 null（调用方回退原 SGF）
 */
export function buildTsumegoMinBoard(
  sgf: string,
  opts?: TsumegoMinBoardOptions
): TsumegoMinBoardResult | null {
  const margin = opts?.margin ?? 1;
  const minOriginalSize = opts?.minOriginalSize ?? 13;

  const parser = new SGFParser();
  const result = parser.parse(sgf);
  const tree = result.tree;
  if (!tree) return null;

  const szList = propList(tree.properties['SZ']);
  const originalSize = szList.length > 0 ? parseInt(szList[0]!, 10) || 19 : 19;
  if (originalSize < minOriginalSize) return null;

  // 必须存在 AB/AW 摆子（死活题 / 排局 / 让子棋），否则视为普通对局
  const hasSetup = (tree.properties['AB'] !== undefined) || (tree.properties['AW'] !== undefined);
  if (!hasSetup) return null;

  // 【全树扫描】遍历所有分支，收集全部坐标
  const allCoords: Array<{ x: number; y: number }> = [];
  collectAllCoords(tree, allCoords);
  if (allCoords.length === 0) return null;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of allCoords) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  // 四边留白并夹取到棋盘内
  minX = Math.max(0, minX - margin);
  minY = Math.max(0, minY - margin);
  maxX = Math.min(originalSize - 1, maxX + margin);
  maxY = Math.min(originalSize - 1, maxY + margin);

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;

  // 只有局部明显小于全盘才压缩
  if (w >= originalSize - 2 || h >= originalSize - 2) return null;

  const newW = roundUpToStandard(w);
  const newH = roundUpToStandard(h);
  const newSize: 9 | 13 | 19 = newW >= newH ? newW : newH;

  // 贴原棋盘边缘对齐，并保证包围盒完整落在小棋盘内
  const originX = computeOrigin(minX, maxX, newSize, originalSize);
  const originY = computeOrigin(minY, maxY, newSize, originalSize);
  const origin = { x: originX, y: originY };

  // 就地平移所有分支坐标；任一点越界 → 放弃压缩
  const remapOk = remapTree(tree, origin, newSize, true);
  if (!remapOk) return null;

  const outSgf = '(' + serializeTree(tree) + ')';

  // 【转换后自校验】重解析产物，确认无越界坐标；失败则回退原 SGF
  if (!validateInRange(outSgf, newSize)) return null;

  return {
    size: newSize,
    sgf: outSgf,
    viewBox: { minX: originX, minY: originY, width: newSize, height: newSize },
    origin,
  };
}
