import { describe, it, expect } from 'vitest';
import { TsumegoChecker } from '../TsumegoChecker';
import type { ReplayData } from '../../../../domain/sgf';

function buildTsumego(): ReplayData {
  return {
    game_name: 't', black: 'b', white: 'w', board_size: 9, max_moves: 0,
    handicap_stones: [{ x: 2, y: 2, color: 'B' }, { x: 6, y: 6, color: 'B' }],
    tree: {
      color: null, coord: null,
      children: [
        { color: 'B', coord: 'cc', properties: { C: '正解图' }, children: [
          { color: 'W', coord: 'gc', children: [
            { color: 'B', coord: 'cg', children: [
              { color: 'W', coord: 'gg', children: [
                { color: 'B', coord: 'ee' }
              ] }
            ] }
          ] }
        ] },
        { color: 'B', coord: 'gc', properties: { C: '正解图' }, children: [
          { color: 'W', coord: 'cc', children: [
            { color: 'B', coord: 'gg' }
          ] }
        ] },
        { color: 'B', coord: 'cc', properties: { C: '失败图' }, children: [
          { color: 'W', coord: 'gg' }
        ] },
      ]
    }
  } as any;
}

describe('TsumegoChecker.solveMove', () => {
  it('detects tsumego', () => {
    const c = new TsumegoChecker();
    c.init(buildTsumego());
    expect(c.getIsTsumego()).toBe(true);
    expect(c.getCorrectBranches().length).toBe(2);
  });

  it('wrong on first move not matching any correct branch', () => {
    const c = new TsumegoChecker();
    c.init(buildTsumego());
    const r = c.solveMove({ x: 0, y: 0, color: 'B' });
    expect(r.status).toBe('wrong');
  });

  it('branch A (cc->gc->cg->gg->ee) full solve', () => {
    const c = new TsumegoChecker();
    c.init(buildTsumego());
    expect(c.solveMove({ x: 2, y: 2, color: 'B' }).opponentMove).toEqual({ x: 6, y: 2, color: 'W' });
    expect(c.solveMove({ x: 2, y: 6, color: 'B' }).opponentMove).toEqual({ x: 6, y: 6, color: 'W' });
    expect(c.solveMove({ x: 4, y: 4, color: 'B' }).status).toBe('solved');
  });

  it('wrong if user deviates from branch', () => {
    const c = new TsumegoChecker();
    c.init(buildTsumego());
    c.solveMove({ x: 2, y: 2, color: 'B' });
    expect(c.solveMove({ x: 6, y: 6, color: 'B' }).status).toBe('wrong');
  });

  it('branch B (gc->cc->gg) full solve', () => {
    const c = new TsumegoChecker();
    c.init(buildTsumego());
    expect(c.solveMove({ x: 6, y: 2, color: 'B' }).opponentMove).toEqual({ x: 2, y: 2, color: 'W' });
    expect(c.solveMove({ x: 6, y: 6, color: 'B' }).status).toBe('solved');
  });

  // 关键回归：两个正解分支前几手相同、之后分叉，用户走任一条都应判对
  it('shared-prefix branches: taking branch A (ee) solves', () => {
    const c = new TsumegoChecker();
    c.init(twoCorrectShared());
    expect(c.getCorrectBranches().length).toBe(2);
    // 共享前缀: cc(B) gc(W) cg(B) gg(W)
    expect(c.solveMove({ x: 2, y: 2, color: 'B' }).opponentMove).toEqual({ x: 6, y: 2, color: 'W' });
    expect(c.solveMove({ x: 2, y: 6, color: 'B' }).opponentMove).toEqual({ x: 6, y: 6, color: 'W' });
    // 用户走分支 A 末手 ee
    expect(c.solveMove({ x: 4, y: 4, color: 'B' }).status).toBe('solved');
  });

  it('shared-prefix branches: taking branch B (ff) ALSO solves', () => {
    const c = new TsumegoChecker();
    c.init(twoCorrectShared());
    c.solveMove({ x: 2, y: 2, color: 'B' });
    c.solveMove({ x: 2, y: 6, color: 'B' });
    // 用户走分支 B 末手 ff (5,5) —— 也应判正解，而非因锁定了 A 分支误判
    expect(c.solveMove({ x: 5, y: 5, color: 'B' }).status).toBe('solved');
  });

  it('fails when move matches a wrong branch but no correct branch', () => {
    const c = new TsumegoChecker();
    c.init(buildTsumego());
    // cc 也是失败图的起始，但失败图第一步应手是 gg；用户走 cc 后，正确分支也接受 cc
    const r = c.solveMove({ x: 2, y: 2, color: 'B' });
    expect(r.status).toBe('continue');
  });
});

// 两个正解分支共享前 3 手：cc(B) gc(W) cg(B) gg(W)，之后分叉：
//   分支1: ee(B)
//   分支2: ff(B)
function twoCorrectShared(): ReplayData {
  return {
    game_name: 't', black: 'b', white: 'w', board_size: 9, max_moves: 0,
    handicap_stones: [{ x: 1, y: 1, color: 'B' }],
    tree: {
      color: null, coord: null,
      children: [
        { color: 'B', coord: 'cc', properties: { C: '正解图' }, children: [
          { color: 'W', coord: 'gc', children: [
            { color: 'B', coord: 'cg', children: [
              { color: 'W', coord: 'gg', children: [
                { color: 'B', coord: 'ee' }
              ] }
            ] }
          ] }
        ] },
        { color: 'B', coord: 'cc', properties: { C: '正解图' }, children: [
          { color: 'W', coord: 'gc', children: [
            { color: 'B', coord: 'cg', children: [
              { color: 'W', coord: 'gg', children: [
                { color: 'B', coord: 'ff' }
              ] }
            ] }
          ] }
        ] },
        { color: 'B', coord: 'cc', properties: { C: '失败图' }, children: [
          { color: 'W', coord: 'gg' }
        ] },
      ]
    }
  } as any;
}

// 分支以「应对方」着法收尾：B(0) W(1) B(2) W(3)，两个正解分支着法一一对应
function oppEnding(): ReplayData {
  return {
    game_name: 't', black: 'b', white: 'w', board_size: 9, max_moves: 0,
    handicap_stones: [{ x: 1, y: 1, color: 'B' }],
    tree: {
      color: null, coord: null,
      children: [
        { color: 'B', coord: 'cc', properties: { C: '正解图' }, children: [
          { color: 'W', coord: 'gc', children: [
            { color: 'B', coord: 'cg', children: [
              { color: 'W', coord: 'gg' }
            ] }
          ] }
        ] },
        { color: 'B', coord: 'cc', properties: { C: '正解图' }, children: [
          { color: 'W', coord: 'gc', children: [
            { color: 'B', coord: 'cg', children: [
              { color: 'W', coord: 'gg' }
            ] }
          ] }
        ] },
      ]
    }
  } as any;
}

describe('分支以应对方收尾（回归）', () => {
  it('用户走完最后一手黑棋后，应手标记 doneAfterReply=true', () => {
    const c = new TsumegoChecker();
    c.init(oppEnding());
    expect(c.getCorrectBranches().length).toBe(2);

    const r1 = c.solveMove({ x: 2, y: 2, color: 'B' });
    expect(r1.status).toBe('continue');
    expect(r1.opponentMove).toEqual({ x: 6, y: 2, color: 'W' });
    expect(r1.doneAfterReply).toBe(false);

    const r2 = c.solveMove({ x: 2, y: 6, color: 'B' });
    expect(r2.status).toBe('continue');
    expect(r2.opponentMove).toEqual({ x: 6, y: 6, color: 'W' });
    expect(r2.doneAfterReply).toBe(true);
  });
});


describe('TsumegoChecker.getNextCandidates', () => {
  it('empty sequence shows first-move candidates (correct=blue, wrong=red)', () => {
    const c = new TsumegoChecker();
    c.init(buildTsumego());
    const cands = c.getNextCandidates([]);
    // 三个分支首手：正解A cc(2,2)、正解B gc(6,2)、失败 cc(2,2)
    // cc 命中正解+失败 → 正解优先(蓝)；gc 命中正解(蓝)
    const map = new Map(cands.map(k => [`${k.x},${k.y}`, k.branchType]));
    expect(map.get('2,2')).toBe('correct');
    expect(map.get('6,2')).toBe('correct');
    expect(map.size).toBe(2);
  });

  it('after first correct move, candidates are the next hands', () => {
    const c = new TsumegoChecker();
    c.init(buildTsumego());
    const cands = c.getNextCandidates([{ x: 2, y: 2, color: 'black' }]);
    // 走 cc 后：正解A下一手 gc(6,2)=W；失败图下一手 gg(6,6)=W
    const map = new Map(cands.map(k => [`${k.x},${k.y}`, k.branchType]));
    expect(map.get('6,2')).toBe('correct');
    expect(map.get('6,6')).toBe('wrong');
  });

  it('returns empty when sequence completed all candidates', () => {
    const c = new TsumegoChecker();
    c.init(buildTsumego());
    const cands = c.getNextCandidates([
      { x: 2, y: 2, color: 'black' },
      { x: 6, y: 2, color: 'white' },
      { x: 2, y: 6, color: 'black' },
      { x: 6, y: 6, color: 'white' },
      { x: 4, y: 4, color: 'black' },
    ]);
    expect(cands.length).toBe(0);
  });

  it('non-tsumego returns empty', () => {
    const c = new TsumegoChecker();
    c.init(null);
    expect(c.getNextCandidates([])).toEqual([]);
  });
});
