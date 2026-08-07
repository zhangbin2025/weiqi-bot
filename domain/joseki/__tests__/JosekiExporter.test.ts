/**
 * 定式树导出单元测试
 */

import { describe, it, expect } from 'vitest';
import { exportTree, exportTreeWithCandidates } from '../JosekiExporter';

describe('exportTree', () => {
  it('应生成有效的 SGF', () => {
    const sgf = exportTree(['pd', 'dd'], ['pd', 'dd'], 5);

    expect(sgf).toContain('GM[1]');
    expect(sgf).toContain('SZ[19]');
    expect(sgf).toContain('B[pd]');
    expect(sgf).toContain('W[dd]');
  });

  it('应包含正确的 SGF 头部', () => {
    const sgf = exportTree(['pd'], ['pd'], 5);

    expect(sgf).toMatch(/\(;GM\[1\]/);
    expect(sgf).toContain('FF[4]');
    expect(sgf).toContain('CA[UTF-8]');
    expect(sgf).toMatch(/\)$/);
  });

  it('应处理空序列', () => {
    const sgf = exportTree([], [], 5);

    expect(sgf).toContain('GM[1]');
    expect(sgf).toContain('SZ[19]');
  });

  it('应限制输出深度', () => {
    const moves = ['pd', 'dd', 'pp', 'dp', 'dc', 'cp', 'cc', 'pc'];
    const sgf = exportTree(moves, moves, 3);

    // 应只包含前3手
    expect(sgf).toContain('B[pd]');
    expect(sgf).toContain('W[dd]');
    expect(sgf).toContain('B[pp]');
    // 不应包含第4手及以后
    expect(sgf).not.toContain('W[dp]');
  });

  it('应正确交替黑白手', () => {
    const sgf = exportTree(['pd', 'dd', 'pp'], ['pd', 'dd', 'pp'], 10);

    expect(sgf).toContain('B[pd]');
    expect(sgf).toContain('W[dd]');
    expect(sgf).toContain('B[pp]');
  });

  it('应跳过 pass 手但保持黑白交替', () => {
    const sgf = exportTree(['pd', 'tt', 'dd'], ['pd', 'tt', 'dd'], 5);

    // pd 是第1手（黑），dd 是第3手（黑）
    expect(sgf).toContain('B[pd]');
    expect(sgf).toContain('B[dd]');
  });
});

describe('exportTreeWithCandidates', () => {
  it('应生成包含候选分支的 SGF', () => {
    const mainPath = ['pd', 'dd', 'pp'];
    const candidates = [['pd', 'dd', 'dq']];
    const sgf = exportTreeWithCandidates(mainPath, candidates, 10);

    expect(sgf).toContain('B[pd]');
    expect(sgf).toContain('W[dd]');
    expect(sgf).toContain('B[pp]');
  });

  it('应处理空候选分支', () => {
    const sgf = exportTreeWithCandidates(['pd'], [], 5);

    expect(sgf).toContain('B[pd]');
  });

  it('应限制候选分支数量', () => {
    const mainPath = ['pd'];
    const candidates = [
      ['pd', 'dd'],
      ['pd', 'dq'],
      ['pd', 'pp'],
      ['pd', 'cc'],
      ['pd', 'qq'],
      ['pd', 'aa'],
    ];
    const sgf = exportTreeWithCandidates(mainPath, candidates, 10);

    // 应只包含前5个候选
    expect(sgf).toContain('dd');
    expect(sgf).toContain('dq');
    expect(sgf).toContain('pp');
    expect(sgf).toContain('cc');
    expect(sgf).toContain('qq');
  });
});