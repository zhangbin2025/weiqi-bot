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

  it('continue then solved on correct branch A', () => {
    const c = new TsumegoChecker();
    c.init(buildTsumego());
    const r1 = c.solveMove({ x: 2, y: 2, color: 'B' }); // cc
    expect(r1.status).toBe('continue');
    expect(r1.opponentMove).toEqual({ x: 6, y: 2, color: 'W' }); // gc
    // branch A 共 5 手：cc(B) gc(W) cg(B) gg(W) ee(B)
    const r2 = c.solveMove({ x: 2, y: 6, color: 'B' }); // cg
    expect(r2.status).toBe('continue');
    expect(r2.opponentMove).toEqual({ x: 6, y: 6, color: 'W' }); // gg
    const r3 = c.solveMove({ x: 4, y: 4, color: 'B' }); // ee
    expect(r3.status).toBe('solved');
  });

  it('wrong if user deviates from locked branch', () => {
    const c = new TsumegoChecker();
    c.init(buildTsumego());
    c.solveMove({ x: 2, y: 2, color: 'B' });
    const r = c.solveMove({ x: 6, y: 6, color: 'B' }); // wrong follow (should be cg)
    expect(r.status).toBe('wrong');
  });

  it('supports multiple correct first moves', () => {
    const c = new TsumegoChecker();
    c.init(buildTsumego());
    const r1 = c.solveMove({ x: 6, y: 2, color: 'B' }); // gc, branch B
    expect(r1.status).toBe('continue');
    expect(r1.opponentMove).toEqual({ x: 2, y: 2, color: 'W' }); // cc
    const r2 = c.solveMove({ x: 6, y: 6, color: 'B' }); // gg
    expect(r2.status).toBe('solved');
  });

  it('longer branch: opponent move uses moves[3] not moves[4] (regression)', () => {
    const c = new TsumegoChecker();
    c.init(buildTsumego());
    // branch A: cc(B) gc(W) cg(B) gg(W) ee(B)
    expect(c.solveMove({ x: 2, y: 2, color: 'B' }).opponentMove).toEqual({ x: 6, y: 2, color: 'W' }); // moves[1]
    // user move 2 = cg (moves[2])
    const r2 = c.solveMove({ x: 2, y: 6, color: 'B' });
    expect(r2.status).toBe('continue');
    expect(r2.opponentMove).toEqual({ x: 6, y: 6, color: 'W' }); // moves[3] = gg, NOT moves[4]=ee
    // user move 3 = ee (moves[4]) -> branch ends -> solved
    const r3 = c.solveMove({ x: 4, y: 4, color: 'B' });
    expect(r3.status).toBe('solved');
  });
});
