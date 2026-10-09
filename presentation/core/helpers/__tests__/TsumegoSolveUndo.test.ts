/**
 * TsumegoChecker 做题模式回退（悔棋）测试
 */
import { describe, it, expect } from 'vitest';
import { TsumegoChecker } from '../TsumegoChecker';
import { sgfToReplayData } from '../../../../domain/sgf';

/** 构造一道死活题 SGF：黑先，正解 B[ab]，白应 W[ba]，再 B[ac] 完成 */
function buildSgf(): string {
  return '(;GM[1]SZ[19]AB[aa]AW[bb];C[正解]B[ab];W[ba];B[ac])';
}

describe('TsumegoChecker 做题模式回退', () => {
  it('未开始做题时 undoSolve 返回 false', () => {
    const checker = new TsumegoChecker();
    checker.init(sgfToReplayData(buildSgf()));
    expect(checker.undoSolve()).toBe(false);
  });

  it('resetSolve 后 undoSolve 返回 false（状态栈被清空）', () => {
    const checker = new TsumegoChecker();
    checker.init(sgfToReplayData(buildSgf()));
    checker.resetSolve();
    expect(checker.undoSolve()).toBe(false);
    expect(checker.getSolveUserMoves()).toBe(0);
  });

  it('答错不推进状态，也不产生可回退的栈', () => {
    const checker = new TsumegoChecker();
    checker.init(sgfToReplayData(buildSgf()));
    // 落一个完全不在正解分支上的点
    const r = checker.solveMove({ x: 10, y: 10, color: 'B' });
    expect(r.status).toBe('wrong');
    // 答错不压栈
    expect(checker.undoSolve()).toBe(false);
    expect(checker.getSolveUserMoves()).toBe(0);
  });

  it('resetSolve 可重复调用且幂等', () => {
    const checker = new TsumegoChecker();
    checker.init(sgfToReplayData(buildSgf()));
    checker.resetSolve();
    checker.resetSolve();
    expect(checker.getSolveUserMoves()).toBe(0);
    expect(checker.undoSolve()).toBe(false);
  });

  it('未初始化时 solveMove 返回 wrong 且不抛错', () => {
    const checker = new TsumegoChecker();
    const r = checker.solveMove({ x: 0, y: 0, color: 'B' });
    expect(r.status).toBe('wrong');
  });
});
