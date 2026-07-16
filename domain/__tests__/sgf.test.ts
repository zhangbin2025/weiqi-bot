/**
 * SGF 解析模块单元测试
 * @module domain/__tests__/sgf.test
 */

import { describe, it, expect } from 'vitest';
import { SGFParser, parseSGF, coordToPos, posToCoord } from '../sgf/index.js';

describe('SGF module', () => {
  describe('coordToPos', () => {
    it('pd -> {x:15, y:3}', () => {
      const result = coordToPos('pd');
      expect(result).not.toBe(null);
      expect(result!.x).toBe(15);
      expect(result!.y).toBe(3);
    });

    it('aa -> {x:0, y:0}', () => {
      const result = coordToPos('aa');
      expect(result).not.toBe(null);
      expect(result!.x).toBe(0);
      expect(result!.y).toBe(0);
    });

    it('空字符串返回null', () => {
      expect(coordToPos('')).toBe(null);
    });

    it('单字符返回null', () => {
      expect(coordToPos('a')).toBe(null);
    });
  });

  describe('posToCoord', () => {
    it('{x:15, y:3} -> pd', () => {
      expect(posToCoord(15, 3)).toBe('pd');
    });

    it('{x:0, y:0} -> aa', () => {
      expect(posToCoord(0, 0)).toBe('aa');
    });
  });

  describe('SGFParser', () => {
    const parser = new SGFParser();

    describe('parse - 基本解析', () => {
      it('返回完整结构', () => {
        const sgf = '(;SZ[19]PB[Black]PW[White];B[dd];W[pp])';
        const result = parser.parse(sgf);

        expect(result.gameInfo);
        expect(result.tree);
        expect(result.stats);
        expect(result.moves);
        expect(result.variations);
        expect(result.winrates);
        expect(Array.isArray(result.errors));
      });

      it('解析棋盘大小', () => {
        const sgf = '(;SZ[19]PB[Black]PW[White])';
        const result = parser.parse(sgf);
        expect(result.gameInfo.boardSize).toBe(19);
      });

      it('解析对局者', () => {
        const sgf = '(;SZ[19]PB[黑方]PW[白方])';
        const result = parser.parse(sgf);
        expect(result.gameInfo.black).toBe('黑方');
        expect(result.gameInfo.white).toBe('白方');
      });

      it('解析贴目', () => {
        const sgf = '(;SZ[19]KM[7.5])';
        const result = parser.parse(sgf);
        expect(result.gameInfo.komi).toBe('7.5');
      });

      it('解析结果', () => {
        const sgf = '(;SZ[19]RE[B+R])';
        const result = parser.parse(sgf);
        expect(result.gameInfo.result).toBe('B+R');
      });
    });

    describe('parse - 变化图', () => {
      it('解析多分支', () => {
        const sgf = '(;SZ[19](;B[dd];W[pp])(;B[dp];W[dd]))';
        const result = parser.parse(sgf);
        expect(result.tree.children.length).toBe(2);
        expect(result.stats.branchCount).toBe(1);
      });

      it('提取变化图', () => {
        const sgf = '(;SZ[19](;B[dd];W[pp])(;B[dp];W[dd]))';
        const result = parser.parse(sgf);
        expect(Object.keys(result.variations).length > 0);
      });
    });

    describe('parse - 胜率注释', () => {
      it('解析野狐格式胜率', () => {
        const sgf = '(;SZ[19];B[dd]C[黑65.3%])';
        const result = parser.parse(sgf);
        expect(result.winrates.length).toBe(1);
        expect(result.winrates[0]!.winrate).toBe(65.3);
        expect(result.winrates[0]!.color).toBe('black');
      });

      it('解析KataGo格式胜率', () => {
        const sgf = '(;SZ[19];W[pp]C[W 48.2%])';
        const result = parser.parse(sgf);
        expect(result.winrates.length).toBe(1);
        expect(result.winrates[0]!.winrate).toBe(48.2);
        expect(result.winrates[0]!.color).toBe('white');
      });

      it('解析星阵格式胜率', () => {
        const sgf = '(;SZ[19];B[dd]C[胜率:黑 70.5%])';
        const result = parser.parse(sgf);
        expect(result.winrates.length).toBe(1);
        expect(result.winrates[0]!.winrate).toBe(70.5);
      });
    });

    describe('parse - 边界情况', () => {
      it('空内容返回空结果', () => {
        const result = parser.parse('');
        expect(result.errors.length > 0);
      });

      it('虚手解析', () => {
        const sgf = '(;SZ[19];B[tt];W[tt])';
        const result = parser.parse(sgf);
        expect(result.moves.length >= 2);
      });

      it('让子解析', () => {
        const sgf = '(;SZ[19]HA[2]AB[pd][dp];W[pp])';
        const result = parser.parse(sgf);
        expect(result.gameInfo.handicap).toBe(2);
        expect(result.gameInfo.handicapStones.length).toBe(2);
      });
    });
  });

  describe('parseSGF便捷函数', () => {
    it('直接调用解析', () => {
      const result = parseSGF('(;SZ[19]PB[Black])');
      expect(result.gameInfo.boardSize).toBe(19);
    });
  });
});
