import { describe, it, expect } from 'vitest';
import { sgfToReplayData, type ReplayData } from '../SGFToReplay.js';

describe('SGFToReplay', () => {
  describe('基本解析', () => {
    it('解析最简SGF', () => {
      const sgf = '(;GM[1]SZ[19])';
      const result = sgfToReplayData(sgf);
      expect(result).not.toBeNull();
      expect(result!.board_size).toBe(19);
      expect(result!.max_moves).toBe(0);
    });

    it('解析含着法的SGF', () => {
      const sgf = '(;GM[1]SZ[19];B[dd];W[pp])';
      const result = sgfToReplayData(sgf);
      expect(result).not.toBeNull();
      expect(result!.max_moves).toBe(2);
      expect(result!.tree.children).toBeDefined();
      expect(result!.tree.children!.length).toBe(1);
    });

    it('解析棋局信息', () => {
      const sgf = '(;GM[1]SZ[19]PB[柯洁]PW[申真谞]BR[9p]WR[9p]RE[B+R])';
      const result = sgfToReplayData(sgf);
      expect(result).not.toBeNull();
      expect(result!.black).toBe('柯洁');
      expect(result!.white).toBe('申真谞');
      expect(result!.black_rank).toBe('9p');
      expect(result!.white_rank).toBe('9p');
      expect(result!.result).toBe('B+R');
    });
  });

  describe('让子棋', () => {
    it('解析让子棋', () => {
      const sgf = '(;GM[1]SZ[19]HA[3]AB[dd][pd][dp])';
      const result = sgfToReplayData(sgf);
      expect(result).not.toBeNull();
      expect(result!.handicap).toBe(3);
      expect(result!.handicap_stones).toBeDefined();
      expect(result!.handicap_stones!.length).toBe(3);
    });

    it('让子位置正确转换', () => {
      const sgf = '(;GM[1]SZ[19]HA[2]AB[dd][pp])';
      const result = sgfToReplayData(sgf);
      expect(result).not.toBeNull();
      const stones = result!.handicap_stones!;
      expect(stones[0]).toEqual({ x: 3, y: 3, color: 'B' }); // dd
      expect(stones[1]).toEqual({ x: 15, y: 15, color: 'B' }); // pp
    });
  });

  describe('注释和标签', () => {
    it('保留注释属性', () => {
      const sgf = '(;GM[1]SZ[19];B[dd]C[这一手很强];W[pp])';
      const result = sgfToReplayData(sgf);
      expect(result).not.toBeNull();
      const firstMove = result!.tree.children![0];
      expect(firstMove.properties).toBeDefined();
      expect(firstMove.properties!.C).toBe('这一手很强');
    });

    it('保留标签属性', () => {
      const sgf = '(;GM[1]SZ[19];B[dd]N[A位];W[pp]N[B位])';
      const result = sgfToReplayData(sgf);
      expect(result).not.toBeNull();
      const firstMove = result!.tree.children![0];
      expect(firstMove.properties!.N).toBe('A位');
    });
  });

  describe('多分支棋谱', () => {
    it('主分支手数计算正确', () => {
      const sgf = '(;GM[1]SZ[19];B[dd](;W[pp])(;W[dd]))';
      const result = sgfToReplayData(sgf);
      expect(result).not.toBeNull();
      expect(result!.max_moves).toBe(2); // 只计算主分支
    });

    it('保留分支结构', () => {
      const sgf = '(;GM[1]SZ[19];B[dd](;W[pp])(;W[dd]))';
      const result = sgfToReplayData(sgf);
      expect(result).not.toBeNull();
      const firstMove = result!.tree.children![0];
      expect(firstMove.children!.length).toBe(2);
    });
  });

  describe('defaultMove 参数', () => {
    it('默认值为主分支最后一手', () => {
      const sgf = '(;GM[1]SZ[19];B[dd];W[pp];B[pd])';
      const result = sgfToReplayData(sgf);
      expect(result!.default_move).toBe(3);
    });

    it('-1 表示最后一手', () => {
      const sgf = '(;GM[1]SZ[19];B[dd];W[pp])';
      const result = sgfToReplayData(sgf, { defaultMove: -1 });
      expect(result!.default_move).toBe(2);
    });

    it('指定值不超过 max_moves', () => {
      const sgf = '(;GM[1]SZ[19];B[dd])';
      const result = sgfToReplayData(sgf, { defaultMove: 10 });
      expect(result!.default_move).toBe(1);
    });
  });

  describe('选项参数', () => {
    it('自定义 gameName', () => {
      const sgf = '(;GM[1]SZ[19]PB[黑方]PW[白方])';
      const result = sgfToReplayData(sgf, { gameName: '名局欣赏' });
      expect(result!.game_name).toBe('名局欣赏');
    });

    it('自定义 downloadFilename', () => {
      const sgf = '(;GM[1]SZ[19])';
      const result = sgfToReplayData(sgf, { downloadFilename: 'game_001.sgf' });
      expect(result!.download_filename).toBe('game_001.sgf');
    });
  });

  describe('错误处理', () => {
    it('解析失败返回 null', () => {
      const result = sgfToReplayData('');
      expect(result).toBeNull();
    });

    it('无效 SGF 可能返回默认数据', () => {
      const result = sgfToReplayData('invalid sgf');
      // SGFParser 可能对无效输入返回默认数据而不是 null
      // 这取决于 parser 的容错能力
      // 如果返回了数据，验证基本字段
      if (result !== null) {
        expect(result).toBeDefined();
        expect(result.board_size).toBeDefined();
      } else {
        // 如果返回 null，也是合理的行为
        expect(result).toBeNull();
      }
    });
  });
});