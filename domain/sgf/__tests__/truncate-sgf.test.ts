import { describe, it, expect } from 'vitest';
import { SGFParser } from '../SGFParser.js';
import { sgfToReplayData } from '../SGFToReplay.js';

/**
 * 截断 SGF 解析的容错测试
 * 
 * 原则：尽可能解析，能解析多少算多少
 * 解析器对所有错误都做了容错处理，只要有有效内容就返回结果
 */
describe('SGF 容错处理 - 尽可能解析', () => {
  const parser = new SGFParser();

  describe('截断场景', () => {
    it('完整的 SGF 应正常解析', () => {
      const fullSGF = '(;GM[1]FF[4]SZ[19]GN[Test];B[qd](;W[dd](;B[pq](;W[ic]))';
      const result = parser.parse(fullSGF);
      expect(result.moves.length).toBeGreaterThan(0);
      
      const replayData = sgfToReplayData(fullSGF);
      expect(replayData).not.toBeNull();
      expect(replayData!.game_name).toBe('Test');
    });

    it('截断的 SGF（在属性值中）应返回部分结果', () => {
      const truncated = '(;GM[1]SZ[19]GN[Test];B[qd](;W[dd](;B[pq](;W[ic';
      const result = parser.parse(truncated);
      expect(result.errors.some(e => e.includes('未闭合'))).toBe(true);
      
      const replayData = sgfToReplayData(truncated);
      expect(replayData).not.toBeNull();
      expect(replayData!.max_moves).toBeGreaterThan(0);
    });

    it('复杂场景：包含中文和特殊字符的截断 SGF', () => {
      const complexTruncated = '(;GM[1]FF[4]\r\nSZ[19]\r\nGN[2026中国女子围甲第5轮 上海清一VS上海星小<绝艺讲解>]\r\nDT[2026-06-17]\r\nPB[唐奕]\r\nPW[李赫]\r\n;B[qd]\r\n(;W[dd]\r\n(;B[pq]\r\n(;W[dp]\r\n(;B[oc]\r\n(;W[qo]\r\n(;B[op]\r\n(;W[ql]\r\n(;B[cc]\r\n(;W[cd]\r\n(;B[dc]\r\n(;W[fc]\r\n(;B[ec]\r\n(;W[ed]\r\n(;B[fb]\r\n(;W[bc]\r\n(;B[bb]\r\n(;W[eb]\r\n(;B[bd]\r\n(;W[cb]\r\n(;B[ac]\r\n(;W[db]\r\n(;B[bc]\r\n(;W[gb]\r\n(;B[fd]\r\n(;W[gc]\r\n(;B[ee]\r\n(;W[fe]\r\n(;B[gd]\r\n(;W[ef';
      
      const result = parser.parse(complexTruncated);
      expect(result.errors.length).toBeGreaterThan(0);
      
      const replayData = sgfToReplayData(complexTruncated);
      expect(replayData).not.toBeNull();
      expect(replayData!.black).toBe('唐奕');
      expect(replayData!.white).toBe('李赫');
      expect(replayData!.max_moves).toBeGreaterThan(25);
    });
  });

  describe('格式错误场景', () => {
    it('多余的右括号应被容错', () => {
      // 多余的 ))) 应该被忽略
      const sgf = '(;GM[1]SZ[19];B[qd];W[dd]))))';
      const result = parser.parse(sgf);
      // 应该报告"多余的右括号"错误
      expect(result.errors.some(e => e.includes('多余'))).toBe(true);
      
      // 但仍应返回有效结果
      const replayData = sgfToReplayData(sgf);
      expect(replayData).not.toBeNull();
      expect(replayData!.max_moves).toBe(2);
    });

    it('意外字符应被跳过', () => {
      // 属性名中间出现意外字符
      const sgf = '(;GM[1]SZ[19]X@Y[value];B[qd])';
      const result = parser.parse(sgf);
      expect(result.errors.some(e => e.includes('跳过'))).toBe(true);
      
      const replayData = sgfToReplayData(sgf);
      expect(replayData).not.toBeNull();
    });

    it('小写属性名应被跳过', () => {
      const sgf = '(;gm[1]sz[19]PB[黑])';
      const result = parser.parse(sgf);
      expect(result.errors.some(e => e.includes('属性名应为大写字母'))).toBe(true);
      
      const replayData = sgfToReplayData(sgf);
      // 小写属性被跳过，但 PB[黑] 应被解析
      expect(replayData).not.toBeNull();
      expect(replayData!.black).toBe('黑');
    });

    it('缺少根括号应自动补全', () => {
      const sgf = ';GM[1]SZ[19];B[qd];W[dd]';
      const result = parser.parse(sgf);
      // 解析器会自动包裹虚拟括号，可能没有错误
      
      const replayData = sgfToReplayData(sgf);
      expect(replayData).not.toBeNull();
      expect(replayData!.max_moves).toBe(2);
    });

    it('括号未闭合应自动补全', () => {
      const sgf = '(;GM[1]SZ[19];B[qd](;W[dd]';
      const result = parser.parse(sgf);
      expect(result.errors.some(e => e.includes('括号未完全闭合'))).toBe(true);
      
      const replayData = sgfToReplayData(sgf);
      expect(replayData).not.toBeNull();
    });
  });

  describe('无效内容场景', () => {
    it('空 SGF 应返回 null', () => {
      expect(sgfToReplayData('')).toBeNull();
      expect(sgfToReplayData('   ')).toBeNull();
    });

    it('完全无效的内容应返回 null', () => {
      expect(sgfToReplayData('not an sgf file')).toBeNull();
      expect(sgfToReplayData('random text')).toBeNull();
    });

    it('只有括号没有内容应返回 null', () => {
      expect(sgfToReplayData('()')).toBeNull();
      expect(sgfToReplayData('(())')).toBeNull();
    });

    it('只有分号没有属性应返回 null', () => {
      expect(sgfToReplayData('(;)')).toBeNull();
    });
  });

  describe('混合错误场景', () => {
    it('多种错误同时存在应返回部分结果', () => {
      // 截断 + 多余括号 + 意外字符
      const messySGF = '(;GM[1]SZ[19]X@Y[test];B[qd])))(;W[ic';
      const result = parser.parse(messySGF);
      // 应有多种错误
      expect(result.errors.length).toBeGreaterThan(1);
      
      const replayData = sgfToReplayData(messySGF);
      expect(replayData).not.toBeNull();
    });
  });
});
