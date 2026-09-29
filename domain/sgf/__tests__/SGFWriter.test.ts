import { describe, it, expect } from 'vitest';
import { SGFParser } from '../SGFParser.js';
import { SGFWriter } from '../SGFWriter.js';

describe('SGFWriter.writeTree', () => {
  const parser = new SGFParser();
  const writer = new SGFWriter();

  it('序列化简单线性SGF', () => {
    const sgf = '(;GM[1]SZ[19];B[pd];W[dd];B[pq])';
    const result = parser.parse(sgf);
    const out = writer.writeTree(result.tree);
    // 应该是 (;...;B[pd];W[dd];B[pq])
    expect(out).toContain('B[pd]');
    expect(out).toContain('W[dd]');
    expect(out).toContain('B[pq]');
    expect(out.startsWith('(')).toBe(true);
    expect(out.endsWith(')')).toBe(true);
  });

  it('序列化带分支的SGF', () => {
    const sgf = '(;GM[1]SZ[19];B[pd](;W[dd])(;W[dp]))';
    const result = parser.parse(sgf);
    const out = writer.writeTree(result.tree);
    expect(out).toContain('B[pd]');
    expect(out).toContain('W[dd]');
    expect(out).toContain('W[dp]');
    // 两个分支应该各自被 () 包裹
    expect(out).toContain('(;W[dd])');
    expect(out).toContain('(;W[dp])');
  });

  it('序列化多层嵌套分支', () => {
    const sgf = '(;GM[1]SZ[19];B[pd](;W[dd](;B[pq](;W[dp])(;W[pp]))(;B[cd])))';
    const result = parser.parse(sgf);
    const out = writer.writeTree(result.tree);
    expect(out).toContain('B[pd]');
    expect(out).toContain('W[dd]');
    expect(out).toContain('B[pq]');
    expect(out).toContain('W[dp]');
    expect(out).toContain('W[pp]');
    expect(out).toContain('B[cd]');
  });

  it('白名单过滤：仅保留指定属性', () => {
    const sgf = '(;GM[1]FF[4]CA[UTF-8]SZ[19]PB[黑]PW[白]KM[6.5]RE[B+R];B[pd]C[comment];W[dd])';
    const result = parser.parse(sgf);
    const whitelist = new Set(['B', 'W', 'SZ', 'PB', 'PW']);
    const out = writer.writeTree(result.tree, { whitelist });
    expect(out).toContain('SZ[19]');
    expect(out).toContain('PB[黑]');
    expect(out).toContain('PW[白]');
    expect(out).toContain('B[pd]');
    expect(out).toContain('W[dd]');
    // 被过滤掉的属性
    expect(out).not.toContain('GM[');
    expect(out).not.toContain('FF[');
    expect(out).not.toContain('CA[');
    expect(out).not.toContain('KM[');
    expect(out).not.toContain('RE[');
    expect(out).not.toContain('C[comment]');
  });

  it('黑名单过滤：排除指定属性', () => {
    const sgf = '(;GM[1]SZ[19]PB[黑]PW[白]KM[6.5];B[pd]C[hello];W[dd])';
    const result = parser.parse(sgf);
    const blacklist = new Set(['C', 'KM', 'PB', 'PW']);
    const out = writer.writeTree(result.tree, { blacklist });
    expect(out).toContain('GM[1]');
    expect(out).toContain('SZ[19]');
    expect(out).toContain('B[pd]');
    expect(out).toContain('W[dd]');
    expect(out).not.toContain('PB[');
    expect(out).not.toContain('PW[');
    expect(out).not.toContain('KM[');
    expect(out).not.toContain('C[hello]');
  });

  it('正确序列化多值属性（AB/AW）', () => {
    const sgf = '(;GM[1]SZ[9]AB[ae][ai][be]AW[af][ag];B[bh])';
    const result = parser.parse(sgf);
    const out = writer.writeTree(result.tree);
    expect(out).toContain('AB[ae][ai][be]');
    expect(out).toContain('AW[af][ag]');
    expect(out).toContain('B[bh]');
  });

  it('正确转义C[]中的特殊字符', () => {
    // SGF 中 ] 需要用 \] 转义，解析器会还原为 ]
    const sgf = '(;GM[1]SZ[19];B[pd]C[含\\]括号];W[dd])';
    const result = parser.parse(sgf);
    expect(result.errors.length).toBe(0);
    const out = writer.writeTree(result.tree);
    // 序列化时 ] 应被重新转义为 \]
    expect(out).toContain('C[含\\]括号]');
  });

  it('处理空子节点数组', () => {
    const sgf = '(;GM[1]SZ[19];B[pd])';
    const result = parser.parse(sgf);
    const out = writer.writeTree(result.tree);
    expect(out).toBe('(;GM[1]SZ[19];B[pd])');
  });

  it('序列化死活题分支结构', () => {
    const sgf = '(;GM[1]FF[4]CA[UTF-8]SZ[9]PB[x]PW[y]AB[ae][be]AW[af][bf](;C[正解图]B[ce];W[cd];B[dd])(;C[失败图]B[cd];W[ce])(;C[变化图]B[dd];W[ce];B[cd]))';
    const result = parser.parse(sgf);
    const out = writer.writeTree(result.tree);
    expect(out).toContain('C[正解图]');
    expect(out).toContain('C[失败图]');
    expect(out).toContain('C[变化图]');
    expect(out).toContain('(;C[正解图]B[ce];W[cd];B[dd])');
    expect(out).toContain('(;C[失败图]B[cd];W[ce])');
    expect(out).toContain('(;C[变化图]B[dd];W[ce];B[cd])');
  });

  it('round-trip：解析→序列化→解析结果一致', () => {
    const original = '(;GM[1]FF[4]CA[UTF-8]SZ[19]PB[黑棋]PW[白棋]KM[6.5]RU[Japanese]RE[B+R];B[pd](;W[dd](;B[pq];W[dp])(;B[cd];W[pp])))';
    const result1 = parser.parse(original);
    const serialized = writer.writeTree(result1.tree);
    const result2 = parser.parse(serialized);
    expect(result2.gameInfo.boardSize).toBe(19);
    expect(result2.gameInfo.black).toBe('黑棋');
    expect(result2.gameInfo.white).toBe('白棋');
    expect(result2.gameInfo.komi).toBe('6.5');
    expect(result2.gameInfo.rules).toBe('Japanese');
    expect(result2.gameInfo.result).toBe('B+R');
    // 主分支：B[pd] → W[dd] → B[pq] → W[dp]
    expect(result2.moves.length).toBe(4);
    expect(result2.stats.branchCount).toBeGreaterThan(0);
  });
});
