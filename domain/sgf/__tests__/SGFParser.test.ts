import { describe, it, expect } from 'vitest';
import { SGFParser, parseSGF, coordToPos, posToCoord } from '../SGFParser.js';

describe('SGFParser', () => {
  describe('parse', () => {
    it('解析空内容返回空结果', () => {
      const parser = new SGFParser();
      const result = parser.parse('');
      expect(result.errors.length > 0);
    });
    it('解析最简SGF', () => {
      const parser = new SGFParser();
      const sgf = '(;GM[1]SZ[19])';
      const result = parser.parse(sgf);
      expect(result.errors.length).toBe(0);
      expect(result.gameInfo.boardSize).toBe(19);
    });
    it('解析含着法的SGF', () => {
      const parser = new SGFParser();
      const sgf = '(;GM[1]SZ[19];B[dd];W[pp])';
      const result = parser.parse(sgf);
      expect(result.moves.length).toBe(2);
      expect(result.moves[0].coord).toBe('dd');
      expect(result.moves[1].coord).toBe('pp');
    });
    it('解析棋局信息', () => {
      const parser = new SGFParser();
      const sgf = '(;GM[1]SZ[19]PB[黑方]PW[白方]KM[7.5]RE[B+R])';
      const result = parser.parse(sgf);
      expect(result.gameInfo.black).toBe('黑方');
      expect(result.gameInfo.white).toBe('白方');
      expect(result.gameInfo.komi).toBe('7.5');
      expect(result.gameInfo.result).toBe('B+R');
    });
    it('解析让子棋', () => {
      const parser = new SGFParser();
      const sgf = '(;GM[1]SZ[19]HA[3]AB[dd][pd][dp])';
      const result = parser.parse(sgf);
      expect(result.gameInfo.handicap).toBe(3);
      expect(result.gameInfo.handicapStones.length).toBe(3);
    });
    it('解析分支', () => {
      const parser = new SGFParser();
      const sgf = '(;GM[1]SZ[19];B[dd](;W[pp])(;W[dd]))';
      const result = parser.parse(sgf);
      expect(result.stats.branchCount > 0);
    });
    it('计算统计信息', () => {
      const parser = new SGFParser();
      const sgf = '(;GM[1]SZ[19];B[dd];W[pp])';
      const result = parser.parse(sgf);
      expect(result.stats.totalNodes).toBe(3);
      expect(result.stats.moveNodes).toBe(2);
    });
  });

  describe('parseSGF便捷函数', () => {
    it('正确解析', () => {
      const result = parseSGF('(;GM[1]SZ[19];B[dd])');
      expect(result.moves.length).toBe(1);
    });
  });

  describe('坐标转换', () => {
    it('coordToPos: dd → {x:3, y:3}', () => {
      const pos = coordToPos('dd');
      expect(pos !== null);
      expect(pos!.x).toBe(3);
      expect(pos!.y).toBe(3);
    });
    it('coordToPos: 空返回null', () => {
      expect(coordToPos('')).toBe(null);
      expect(coordToPos('d')).toBe(null);
    });
    it('posToCoord: {x:3, y:3} → dd', () => {
      expect(posToCoord(3, 3)).toBe('dd');
    });
    it('posToCoord: {x:0, y:0} → aa', () => {
      expect(posToCoord(0, 0)).toBe('aa');
    });
  });

  describe('错误处理', () => {
    it('记录解析错误', () => {
      const parser = new SGFParser();
      const result = parser.parse('(;GM[1];B[dd');
      expect(result.errors.length > 0);
    });
    it('返回空树而非崩溃', () => {
      const parser = new SGFParser();
      const result = parser.parse('invalid');
      expect(result.tree !== undefined);
    });
  });
});