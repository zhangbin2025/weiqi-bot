/**
 * 方向归一化器 - ruld/rudl 转换 + 去重
 * 对应 Python: weiqi-joseki/src/core/coords.py (convert_to_rudl 等)
 *
 * 注意：convertToTopRight / normalizeCornerSequence 已在 coordinate/CornerConverter.ts 实现
 * 本文件只保留 ruld↔rudl 转换、等价判断、去重
 */

export type Corner = "tr" | "tl" | "br" | "bl";

interface CoordSystem {
  name: string;
  origin: [number, number];
  xDir: [number, number];
  yDir: [number, number];
}

/** 8个坐标系定义 */
const COORDINATE_SYSTEMS: Record<string, CoordSystem> = {
  ruld: { name: "ruld", origin: [18, 0], xDir: [-1, 0], yDir: [0, 1] },
  rudl: { name: "rudl", origin: [18, 0], xDir: [0, 1], yDir: [-1, 0] },
  lurd: { name: "lurd", origin: [0, 0], xDir: [1, 0], yDir: [0, 1] },
  ludr: { name: "ludr", origin: [0, 0], xDir: [0, 1], yDir: [1, 0] },
  ldru: { name: "ldru", origin: [0, 18], xDir: [1, 0], yDir: [0, -1] },
  ldur: { name: "ldur", origin: [0, 18], xDir: [0, -1], yDir: [1, 0] },
  drlu: { name: "drlu", origin: [18, 18], xDir: [-1, 0], yDir: [0, -1] },
  drul: { name: "drul", origin: [18, 18], xDir: [0, -1], yDir: [-1, 0] },
};

function sgfToLocal(sgf: string, sys: CoordSystem): [number, number] | null {
  if (sgf === "tt" || sgf.length !== 2) return null;
  const col = sgf.charCodeAt(0) - 97;
  const row = sgf.charCodeAt(1) - 97;
  const [ox, oy] = sys.origin;
  const [xdx, xdy] = sys.xDir;
  const [ydx, ydy] = sys.yDir;
  const localX = (col - ox) * xdx + (row - oy) * xdy;
  const localY = (col - ox) * ydx + (row - oy) * ydy;
  if (localX < 0 || localX > 18 || localY < 0 || localY > 18) return null;
  return [localX, localY];
}

function localToSgf(local: [number, number], sys: CoordSystem): string | null {
  const [lx, ly] = local;
  const [ox, oy] = sys.origin;
  const [xdx, xdy] = sys.xDir;
  const [ydx, ydy] = sys.yDir;
  const col = ox + lx * xdx + ly * ydx;
  const row = oy + lx * xdy + ly * ydy;
  if (col < 0 || col > 18 || row < 0 || row > 18) return null;
  return String.fromCharCode(97 + col) + String.fromCharCode(97 + row);
}

/** 坐标缓存 */
class CoordCache {
  private toLocal = new Map<string, [number, number]>();
  private toSgf = new Map<string, string>();

  getToLocal(sgf: string, sys: CoordSystem): [number, number] | null {
    const key = `${sys.name}:${sgf}`;
    if (this.toLocal.has(key)) return this.toLocal.get(key)!;
    const local = sgfToLocal(sgf, sys);
    if (local) this.toLocal.set(key, local);
    return local;
  }

  getToSgf(local: [number, number], sys: CoordSystem): string | null {
    const key = `${sys.name}:${local[0]},${local[1]}`;
    if (this.toSgf.has(key)) return this.toSgf.get(key)!;
    const sgf = localToSgf(local, sys);
    if (sgf) this.toSgf.set(key, sgf);
    return sgf;
  }
}

const cache = new CoordCache();

/**
 * ruld → rudl 转换（转置 localX/localY）
 * 对应 Python: convert_to_rudl
 */
export function convertToRudl(moves: string[]): string[] {
  const ruldSys = COORDINATE_SYSTEMS["ruld"]!;
  const rudlSys = COORDINATE_SYSTEMS["rudl"]!;
  return moves.map((sgf) => {
    if (sgf === "tt" || sgf === "pass") return sgf;
    const local = cache.getToLocal(sgf, ruldSys);
    if (!local) return sgf;
    const transposed: [number, number] = [local[1], local[0]];
    const newSgf = cache.getToSgf(transposed, rudlSys);
    return newSgf ?? sgf;
  });
}

/**
 * rudl → ruld 转换（转置 localX/localY）
 * 对应 Python: convert_to_ruld
 */
export function convertToRuld(moves: string[]): string[] {
  const rudlSys = COORDINATE_SYSTEMS["rudl"]!;
  const ruldSys = COORDINATE_SYSTEMS["ruld"]!;
  return moves.map((sgf) => {
    if (sgf === "tt" || sgf === "pass") return sgf;
    const local = cache.getToLocal(sgf, rudlSys);
    if (!local) return sgf;
    const transposed: [number, number] = [local[1], local[0]];
    const newSgf = cache.getToSgf(transposed, ruldSys);
    return newSgf ?? sgf;
  });
}

/** 检查两个序列是否等价（考虑 ruld/rudl 对称） */
export function areEquivalent(seq1: string[], seq2: string[]): boolean {
  if (seq1.length !== seq2.length) return false;
  if (seq1.join(" ") === seq2.join(" ")) return true;
  if (convertToRudl(seq1).join(" ") === seq2.join(" ")) return true;
  if (convertToRuld(seq1).join(" ") === seq2.join(" ")) return true;
  return false;
}

/** 去重（保留第一个出现的） */
export function deduplicateJoseki(sequences: string[][]): string[][] {
  const unique: string[][] = [];
  for (const seq of sequences) {
    let isDup = false;
    for (const existing of unique) {
      if (areEquivalent(seq, existing)) { isDup = true; break; }
    }
    if (!isDup) unique.push(seq);
  }
  return unique;
}
