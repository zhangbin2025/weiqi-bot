/**
 * 方向归一化器
 * 
 * 核心功能：
 * 1. ruld ↔ rudl 方向转换
 * 2. 四角坐标统一到右上角
 * 3. 去重优化
 */

export type Corner = 'tr' | 'tl' | 'br' | 'bl';

interface CoordSystem {
  name: string;
  origin: [number, number];
  xDir: [number, number];
  yDir: [number, number];
}

const COORDINATE_SYSTEMS: Record<string, CoordSystem> = {
  'ruld': { name: 'ruld', origin: [18, 0], xDir: [-1, 0], yDir: [0, 1] },
  'rudl': { name: 'rudl', origin: [18, 0], xDir: [0, 1], yDir: [-1, 0] },
  'lurd': { name: 'lurd', origin: [0, 0], xDir: [1, 0], yDir: [0, 1] },
  'ludr': { name: 'ludr', origin: [0, 0], xDir: [0, 1], yDir: [1, 0] },
  'dlur': { name: 'dlur', origin: [0, 18], xDir: [1, 0], yDir: [0, -1] },
  'dlru': { name: 'dlru', origin: [0, 18], xDir: [0, -1], yDir: [1, 0] },
  'drul': { name: 'drul', origin: [18, 18], xDir: [-1, 0], yDir: [0, -1] },
  'drlu': { name: 'drlu', origin: [18, 18], xDir: [0, -1], yDir: [-1, 0] },
};

function sgfToLocal(sgfCoord: string, system: CoordSystem): [number, number] | null {
  if (sgfCoord === 'tt' || sgfCoord.length !== 2) return null;
  
  const col = sgfCoord.charCodeAt(0) - 97;
  const row = sgfCoord.charCodeAt(1) - 97;
  
  const [ox, oy] = system.origin;
  const [xdx, xdy] = system.xDir;
  const [ydx, ydy] = system.yDir;
  
  const localX = (col - ox) * xdx + (row - oy) * xdy;
  const localY = (col - ox) * ydx + (row - oy) * ydy;
  
  if (localX < 0 || localX > 18 || localY < 0 || localY > 18) return null;
  
  return [localX, localY];
}

function localToSgf(local: [number, number], system: CoordSystem): string | null {
  const [lx, ly] = local;
  const [ox, oy] = system.origin;
  const [xdx, xdy] = system.xDir;
  const [ydx, ydy] = system.yDir;
  
  const col = ox + lx * xdx + ly * ydx;
  const row = oy + lx * xdy + ly * ydy;
  
  if (col < 0 || col > 18 || row < 0 || row > 18) return null;
  
  return String.fromCharCode(97 + col) + String.fromCharCode(97 + row);
}

class CoordCache {
  private toLocalCache: Map<string, [number, number]> = new Map();
  private toSgfCache: Map<string, string> = new Map();
  
  getToLocal(sgfCoord: string, system: CoordSystem): [number, number] | null {
    const key = `${system.name}:${sgfCoord}`;
    if (this.toLocalCache.has(key)) return this.toLocalCache.get(key)!;
    
    const local = sgfToLocal(sgfCoord, system);
    if (local) this.toLocalCache.set(key, local);
    return local;
  }
  
  getToSgf(local: [number, number], system: CoordSystem): string | null {
    const key = `${system.name}:${local[0]},${local[1]}`;
    if (this.toSgfCache.has(key)) return this.toSgfCache.get(key)!;
    
    const sgf = localToSgf(local, system);
    if (sgf) this.toSgfCache.set(key, sgf);
    return sgf;
  }
}

const cache = new CoordCache();

export function convertToRudl(moves: string[]): string[] {
  const ruldSys = COORDINATE_SYSTEMS['ruld']!;
  const rudlSys = COORDINATE_SYSTEMS['rudl']!;
  
  const result: string[] = [];
  
  for (const sgf of moves) {
    if (sgf === 'tt' || sgf === 'pass') {
      result.push(sgf);
      continue;
    }
    
    const local = cache.getToLocal(sgf, ruldSys);
    if (!local) { result.push(sgf); continue; }
    
    const transposed: [number, number] = [local[1], local[0]];
    
    const newSgf = cache.getToSgf(transposed, rudlSys);
    if (!newSgf) { result.push(sgf); continue; }
    
    result.push(newSgf);
  }
  
  return result;
}

export function convertToRuld(moves: string[]): string[] {
  const rudlSys = COORDINATE_SYSTEMS['rudl']!;
  const ruldSys = COORDINATE_SYSTEMS['ruld']!;
  
  const result: string[] = [];
  
  for (const sgf of moves) {
    if (sgf === 'tt' || sgf === 'pass') {
      result.push(sgf);
      continue;
    }
    
    const local = cache.getToLocal(sgf, rudlSys);
    if (!local) { result.push(sgf); continue; }
    
    const transposed: [number, number] = [local[1], local[0]];
    
    const newSgf = cache.getToSgf(transposed, ruldSys);
    if (!newSgf) { result.push(sgf); continue; }
    
    result.push(newSgf);
  }
  
  return result;
}

export function convertToTopRight(moves: string[], corner: Corner): string[] {
  if (corner === 'tr') return moves;
  
  const sourceSys = COORDINATE_SYSTEMS[getCoordinateSystem(corner)];
  const targetSys = COORDINATE_SYSTEMS['ruld']!;
  
  const result: string[] = [];
  
  for (const sgf of moves) {
    if (sgf === 'tt' || sgf === 'pass') {
      result.push(sgf);
      continue;
    }
    
    const local = cache.getToLocal(sgf, sourceSys);
    if (!local) { result.push(sgf); continue; }
    
    const newSgf = cache.getToSgf(local, targetSys);
    if (!newSgf) { result.push(sgf); continue; }
    
    result.push(newSgf);
  }
  
  return result;
}

function getCoordinateSystem(corner: Corner): string {
  const map: Record<Corner, string> = {
    'tr': 'ruld',
    'tl': 'lurd',
    'br': 'drul',
    'bl': 'dlur',
  };
  return map[corner];
}

export function areEquivalent(seq1: string[], seq2: string[]): boolean {
  if (seq1.length !== seq2.length) return false;
  
  if (seq1.join(' ') === seq2.join(' ')) return true;
  
  const rudlSeq1 = convertToRudl(seq1);
  if (rudlSeq1.join(' ') === seq2.join(' ')) return true;
  
  const ruldSeq1 = convertToRuld(seq1);
  if (ruldSeq1.join(' ') === seq2.join(' ')) return true;
  
  return false;
}

export function deduplicateJoseki(sequences: string[][]): string[][] {
  const unique: string[][] = [];
  
  for (const seq of sequences) {
    let isDuplicate = false;
    
    for (const existing of unique) {
      if (areEquivalent(seq, existing)) {
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) unique.push(seq);
  }
  
  return unique;
}

export function normalizeJoseki(moves: string[]): string[] {
  return moves;
}
