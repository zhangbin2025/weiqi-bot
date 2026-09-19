/**
 * 死活题最小路数转换单元测试
 */
import { describe, it, expect } from 'vitest';
import { buildTsumegoMinBoard } from '../sgf/index.js';
import { SGFParser, coordToPos } from '../sgf/index.js';

/** 解析输出 SGF 并取根节点所有棋子坐标 + 主分支着法 */
function parseOut(sgf: string) {
  const r = new SGFParser().parse(sgf);
  const tree = r.tree!;
  const setup: Array<{ x: number; y: number; color: string }> = [];
  const ab = Array.isArray(tree.properties['AB']) ? (tree.properties['AB'] as string[]) : [];
  const aw = Array.isArray(tree.properties['AW']) ? (tree.properties['AW'] as string[]) : [];
  for (const c of ab) { const p = coordToPos(c)!; setup.push({ ...p, color: 'B' }); }
  for (const c of aw) { const p = coordToPos(c)!; setup.push({ ...p, color: 'W' }); }
  const sz = parseInt(String(tree.properties['SZ']), 10) || 19;
  return { tree, setup, sz };
}

describe('buildTsumegoMinBoard', () => {
  it('右上角死活题：最右侧原坐标贴在 9 路棋盘最右列', () => {
    // 右侧边部棋子 sb/sc/se 原 x=18，ra 原 x=17，应落在新棋盘右边缘
    const sgf = '(;SZ[19]AB[ra][rf][qf][sb][sc][se]AW[qa][qb];B[rf];W[qf])';
    const res = buildTsumegoMinBoard(sgf);
    expect(res).not.toBeNull();
    if (!res) return;
    const out = parseOut(res.sgf);
    expect([9, 13, 19]).toContain(out.sz);
    const rightCol = out.sz - 1;
    // 原 x=18 的 sb/sc/se 必须落在最右列
    for (const p of ['sb', 'sc', 'se']) {
      const c = coordToPos(p)!;
      expect(c.x - res.origin.x).toBe(rightCol);
    }
    // 原 x=17 的 ra/rf 必须落在最右列左侧一格
    for (const p of ['ra', 'rf']) {
      const c = coordToPos(p)!;
      expect(c.x - res.origin.x).toBe(rightCol - 1);
    }
    // 原点必须贴原棋盘某边（不是居中 bbox）
    expect(res.origin.x).toBeGreaterThanOrEqual(10); // 19 路右半区
  });

  it('左上角死活题：原点贴原棋盘上边与左边', () => {
    const sgf = '(;SZ[19]AB[aa][ba][ab][ca]AW[bb][cb];B[da])';
    const res = buildTsumegoMinBoard(sgf);
    expect(res).not.toBeNull();
    if (!res) return;
    // 原 (0,0) 的 aa 应映射到 (0,0)
    const c = coordToPos('aa')!;
    expect(c.x - res.origin.x).toBe(0);
    expect(c.y - res.origin.y).toBe(0);
    expect(res.origin.x).toBe(0);
    expect(res.origin.y).toBe(0);
  });

  it('保留所有分支结构（多个答案分支，往返解析一致）', () => {
    // 根部 setup 后接一个着法节点，该着法节点下挂 3 个答案分支
    const sgf = '(;SZ[19]AB[ra][rf][sb]AW[qa];B[rf](;W[qf];B[ra])(;W[qg];B[rb])(;W[qh]))';
    const res = buildTsumegoMinBoard(sgf);
    expect(res).not.toBeNull();
    if (!res) return;
    const out = parseOut(res.sgf);
    // 根节点 1 个子（着法节点），着法节点 3 个分支
    expect(out.tree.children.length).toBe(1);
    expect(out.tree.children[0]!.children.length).toBe(3);
  });

  it('已是小棋盘（9 路）不压缩，返回 null', () => {
    const sgf = '(;SZ[9]AB[cc][gc]AW[cg][gg];B[ec])';
    expect(buildTsumegoMinBoard(sgf)).toBeNull();
  });

  it('无摆子的普通对局不压缩，返回 null', () => {
    const sgf = '(;SZ[19];B[pd];W[dp];B[qp];W[pq])';
    expect(buildTsumegoMinBoard(sgf)).toBeNull();
  });

  it('包含注释 C[] 和标签 N[] 的属性被保留', () => {
    const sgf = '(;SZ[19]AB[ra][rf]C[dead]N[point];B[qf]C[good])';
    const res = buildTsumegoMinBoard(sgf);
    expect(res).not.toBeNull();
    if (!res) return;
    const out = parseOut(res.sgf);
    const c = out.tree.properties['C'];
    const cVal = Array.isArray(c) ? (c[0] as string) : (c as string);
    expect(cVal).toContain('dead');
    const n = out.tree.properties['N'];
    const nVal = Array.isArray(n) ? (n[0] as string) : (n as string);
    expect(nVal).toBe('point');
  });

  it('margin 可控，留白影响局部框大小', () => {
    const sgf = '(;SZ[19]AB[ra][rf]AW[qa];B[qf])';
    const noMargin = buildTsumegoMinBoard(sgf, { margin: 0 });
    const withMargin = buildTsumegoMinBoard(sgf, { margin: 3 });
    expect(noMargin).not.toBeNull();
    expect(withMargin).not.toBeNull();
    if (noMargin && withMargin) {
      expect(withMargin.viewBox.width).toBeGreaterThanOrEqual(noMargin.viewBox.width);
    }
  });

  it('贴左边缘的死活题，最左原 x=0 仍落在第 0 列', () => {
    const sgf = '(;SZ[19]AB[aa][ba][ca][ab]AW[bb];B[da])';
    const res = buildTsumegoMinBoard(sgf);
    expect(res).not.toBeNull();
    if (!res) return;
    const c = coordToPos('aa')!;
    expect(c.x - res.origin.x).toBe(0);
    expect(res.origin.x).toBe(0);
  });

  it('【全树扫描】分支里的棋子纳入包围盒：局部仍小时正常压缩', () => {
    // 主分支在左上 (0..3, 0..3)，但某一变化分支深处有一手棋落在 (10,2)——
    // 主分支自己到不了那里。整个 bbox 仍明显小于全盘，应压缩；
    // 且 (10,2) 必须被纳入并落在小棋盘内（证明分支被扫描）。
    const sgf =
      '(;SZ[19]AB[aa][ba][ca][ab]AW[bb]' +
      ';B[da]' +
      '(' +
      ';W[db]' +
      '(' +
      ';B[ee]' +
      '(' +
      ';W[kc]' + // 分支深处 (10,2)，整盘 bbox 宽≈11 仍明显小于全盘，可压缩
      ')' +
      ')' +
      ')' +
      ')'
    ;
    const res = buildTsumegoMinBoard(sgf);
    expect(res).not.toBeNull();
    if (!res) return;
    const kc = coordToPos('kc')!;
    expect(kc.x - res.origin.x).toBeGreaterThanOrEqual(0);
    expect(kc.x - res.origin.x).toBeLessThan(res.size);
    expect(kc.y - res.origin.y).toBeGreaterThanOrEqual(0);
    expect(kc.y - res.origin.y).toBeLessThan(res.size);
    // origin 仍贴原棋盘上/左边界（角部题）
    expect(res.origin.x).toBe(0);
    expect(res.origin.y).toBe(0);
  });

  it('【全树扫描】分支棋子远在对角时拒绝压缩（回退安全）', () => {
    // 主分支在左上，但变化分支深处有一手 (17,17)。整盘 bbox≈18x18，
    // 无法压缩成小棋盘而不丢子 —— 正确行为是返回 null（回退原 SGF）。
    const sgf =
      '(;SZ[19]AB[aa][ba][ca][ab]AW[bb]' +
      ';B[da]' +
      '(' +
      ';W[db]' +
      '(' +
      ';B[ee]' +
      '(' +
      ';W[rr]' + // (17,17) 远离主局部
      ')' +
      ')' +
      ')' +
      ')'
    ;
    // 若只扫描主分支会错误压缩并越界；正确实现应整体拒绝
    expect(buildTsumegoMinBoard(sgf)).toBeNull();
  });

  it('转换后产物经自校验，所有坐标都在 [0, size-1] 内', () => {
    const sgf = '(;SZ[19]AB[ra][rf][qf][sb][sc][se]AW[qa][qb];B[rf];W[qf])';
    const res = buildTsumegoMinBoard(sgf);
    expect(res).not.toBeNull();
    if (!res) return;
    const size = res.size;
    // 重新解析产物，逐点检查
    const out = parseOut(res.sgf);
    const all: Array<{ x: number; y: number }> = [];
    collectDeep(out.tree, all);
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(size);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(size);
    }
  });
});

/** 递归收集整棵树（含分支）的所有坐标点 */
function collectDeep(node: any, out: Array<{ x: number; y: number }>) {
  const props = node.properties || {};
  for (const key of ['AB', 'AW', 'B', 'W']) {
    const raw = props[key];
    if (raw === undefined) continue;
    const arr = Array.isArray(raw) ? raw : [raw];
    for (const c of arr) {
      const p = coordToPos(String(c));
      if (p) out.push(p);
    }
  }
  if (node.coord && node.color) {
    const p = coordToPos(node.coord);
    if (p) out.push(p);
  }
  for (const child of node.children || []) collectDeep(child, out);
}
