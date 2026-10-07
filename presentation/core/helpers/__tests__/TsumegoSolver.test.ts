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
            { color: 'B', coord: 'cg' }
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
    const r1 = c.solveMove({ x: 2, y: 2, color: 'B' });
    expect(r1.status).toBe('continue');
    expect(r1.opponentMove).toEqual({ x: 6, y: 2, color: 'W' });
    const r2 = c.solveMove({ x: 2, y: 6, color: 'B' });
    expect(r2.status).toBe('solved');
  });

  it('wrong if user deviates from locked branch', () => {
    const c = new TsumegoChecker();
    c.init(buildTsumego());
    c.solveMove({ x: 2, y: 2, color: 'B' });
    const r = c.solveMove({ x: 6, y: 6, color: 'B' });
    expect(r.status).toBe('wrong');
  });

  it('supports multiple correct first moves', () => {
    const c = new TsumegoChecker();
    c.init(buildTsumego());
    const r1 = c.solveMove({ x: 6, y: 2, color: 'B' });
    expect(r1.status).toBe('continue');
    expect(r1.opponentMove).toEqual({ x: 2, y: 2, color: 'W' });
    const r2 = c.solveMove({ x: 6, y: 6, color: 'B' });
    expect(r2.status).toBe('solved');
  });
});
