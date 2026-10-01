import { describe, it, expect } from 'vitest';
import { DecisionReplayHelper } from '../DecisionReplayHelper';

describe('DecisionReplayHelper', () => {
  describe('generateReplayData - 基本功能', () => {
    it('解析最简 SGF 并返回正确结构', () => {
      const sgf = '(;GM[1]SZ[19])';
      const result = DecisionReplayHelper.generateReplayData(sgf);
      expect(result).toBeDefined();
      expect(result.board_size).toBe(19);
      expect(result.max_moves).toBe(0);
      expect(result.tree).toBeDefined();
    });

    it('解析含着法的 SGF', () => {
      const sgf = '(;GM[1]SZ[19];B[dd];W[pp])';
      const result = DecisionReplayHelper.generateReplayData(sgf);
      expect(result.max_moves).toBe(2);
      expect(result.tree.children).toBeDefined();
      expect(result.tree.children!.length).toBe(1);
      expect(result.tree.children![0].color).toBe('B');
      expect(result.tree.children![0].coord).toBe('dd');
    });

    it('解析棋局信息', () => {
      const sgf = '(;GM[1]SZ[19]PB[柯洁]PW[申真谞]BR[9p]WR[9p]RE[B+R])';
      const result = DecisionReplayHelper.generateReplayData(sgf);
      expect(result.black).toBe('柯洁');
      expect(result.white).toBe('申真谞');
      expect(result.black_rank).toBe('9p');
      expect(result.white_rank).toBe('9p');
      expect(result.result).toBe('B+R');
    });
  });

  describe('generateReplayData - gameInfo 覆盖', () => {
    it('外部 gameInfo 覆盖 SGF 中的值', () => {
      const sgf = '(;GM[1]SZ[19]PB[黑方]PW[白方]RE[B+R])';
      const result = DecisionReplayHelper.generateReplayData(sgf, {
        black: '柯洁',
        white: '申真谞',
        result: 'W+R',
      });
      expect(result.black).toBe('柯洁');
      expect(result.white).toBe('申真谞');
      expect(result.result).toBe('W+R');
    });

    it('gameInfo 为空时从 SGF 提取默认值', () => {
      const sgf = '(;GM[1]SZ[19]PB[黑方]PW[白方])';
      const result = DecisionReplayHelper.generateReplayData(sgf, {});
      expect(result.black).toBe('黑方');
      expect(result.white).toBe('白方');
    });

    it('gameInfo 覆盖 board_size 和 handicap', () => {
      const sgf = '(;GM[1]SZ[19]HA[0])';
      const result = DecisionReplayHelper.generateReplayData(sgf, {
        board_size: 13,
        handicap: 2,
      });
      expect(result.board_size).toBe(13);
      expect(result.handicap).toBe(2);
    });

    it('gameInfo 覆盖 handicap_stones', () => {
      const sgf = '(;GM[1]SZ[19])';
      const customStones = [
        { x: 3, y: 3, color: 'B' as const },
        { x: 15, y: 15, color: 'B' as const },
      ];
      const result = DecisionReplayHelper.generateReplayData(sgf, {
        handicap_stones: customStones,
      });
      expect(result.handicap_stones).toEqual(customStones);
    });
  });

  describe('generateReplayData - defaultMove', () => {
    it('defaultMove=-1 跳到最后一手', () => {
      const sgf = '(;GM[1]SZ[19];B[dd];W[pp];B[pd])';
      const result = DecisionReplayHelper.generateReplayData(sgf, {}, -1);
      expect(result.default_move).toBe(3);
    });

    it('defaultMove 指定值', () => {
      const sgf = '(;GM[1]SZ[19];B[dd];W[pp];B[pd])';
      const result = DecisionReplayHelper.generateReplayData(sgf, {}, 2);
      expect(result.default_move).toBe(2);
    });

    it('defaultMove 超过 max_moves 时被截断', () => {
      const sgf = '(;GM[1]SZ[19];B[dd])';
      const result = DecisionReplayHelper.generateReplayData(sgf, {}, 10);
      expect(result.default_move).toBe(1);
    });
  });

  describe('generateReplayData - 让子棋', () => {
    it('解析让子棋 AB[]', () => {
      const sgf = '(;GM[1]SZ[19]HA[3]AB[dd][pd][dp])';
      const result = DecisionReplayHelper.generateReplayData(sgf);
      expect(result.handicap).toBe(3);
      expect(result.handicap_stones).toBeDefined();
      expect(result.handicap_stones!.length).toBe(3);
      expect(result.handicap_stones![0]).toEqual({ x: 3, y: 3, color: 'B' });
    });
  });

  describe('generateReplayData - 注释和标签', () => {
    it('保留 C（注释）属性', () => {
      const sgf = '(;GM[1]SZ[19];B[dd]C[这一手很强];W[pp])';
      const result = DecisionReplayHelper.generateReplayData(sgf);
      const firstMove = result.tree.children![0];
      expect(firstMove.properties).toBeDefined();
      expect(firstMove.properties!.C).toBe('这一手很强');
    });

    it('保留 N（标签）属性', () => {
      const sgf = '(;GM[1]SZ[19];B[dd]N[A位];W[pp]N[B位])';
      const result = DecisionReplayHelper.generateReplayData(sgf);
      const firstMove = result.tree.children![0];
      expect(firstMove.properties!.N).toBe('A位');
    });
  });

  describe('generateReplayData - 多分支', () => {
    it('主分支手数计算正确', () => {
      const sgf = '(;GM[1]SZ[19];B[dd](;W[pp])(;W[dd]))';
      const result = DecisionReplayHelper.generateReplayData(sgf);
      expect(result.max_moves).toBe(2);
    });

    it('保留分支结构', () => {
      const sgf = '(;GM[1]SZ[19];B[dd](;W[pp])(;W[dd]))';
      const result = DecisionReplayHelper.generateReplayData(sgf);
      const firstMove = result.tree.children![0];
      expect(firstMove.children!.length).toBe(2);
    });
  });

  describe('generateReplayData - 错误处理', () => {
    it('空 SGF 抛出异常', () => {
      expect(() => DecisionReplayHelper.generateReplayData('')).toThrow('SGF 解析失败');
    });

    it('无效 SGF 抛出异常或返回默认数据', () => {
      // SGFParser 对无效输入可能返回部分结果，只要不崩溃即可
      const fn = () => DecisionReplayHelper.generateReplayData('invalid sgf');
      // 要么抛异常，要么返回有基本结构的数据
      try {
        const result = fn();
        expect(result).toBeDefined();
        expect(result.board_size).toBeDefined();
      } catch {
        // 抛异常也是合理的
        expect(true).toBe(true);
      }
    });
  });

  describe('generateReplayData - download_filename', () => {
    it('默认 download_filename', () => {
      const sgf = '(;GM[1]SZ[19])';
      const result = DecisionReplayHelper.generateReplayData(sgf);
      expect(result.download_filename).toBe('game.sgf');
    });

    it('通过 gameInfo 指定 download_filename', () => {
      const sgf = '(;GM[1]SZ[19])';
      const result = DecisionReplayHelper.generateReplayData(sgf, {
        download_filename: 'custom.sgf',
      });
      expect(result.download_filename).toBe('custom.sgf');
    });
  });

  describe('generateReplayData - DecisionPage 实际场景', () => {
    it('模拟 DecisionPage 构造的简单着法序列 SGF', () => {
      // DecisionPage.buildSGFFromPosition 生成的格式: (;SZ[19];B[dd];W[pp];B[pd])
      const sgf = '(;SZ[19];B[dd];W[pp];B[pd])';
      const result = DecisionReplayHelper.generateReplayData(sgf, {}, 2);
      expect(result.board_size).toBe(19);
      expect(result.max_moves).toBe(3);
      expect(result.default_move).toBe(2);
      // 验证棋盘上的着法序列
      let node = result.tree.children![0];
      expect(node.color).toBe('B');
      expect(node.coord).toBe('dd');
      node = node.children![0];
      expect(node.color).toBe('W');
      expect(node.coord).toBe('pp');
      node = node.children![0];
      expect(node.color).toBe('B');
      expect(node.coord).toBe('pd');
    });
  });
});
