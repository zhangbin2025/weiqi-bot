import { describe, it, expect } from 'vitest';
import { KoRule } from '../KoRule.js';
import { Board } from '../../board/Board.js';
import { createCoordinate } from '../../coordinate/ICoordinate.js';

describe('KoRule', () => {
  const rule = new KoRule();

  describe('isKoViolation', () => {
    it('无前一状态时不违规', () => {
      const board = new Board(19);
      expect(rule.isKoViolation(board, null, 3, 3)).toBe(false);
    });
    it('相同状态违规', () => {
      const board1 = new Board(19);
      board1.setStone(3, 3, 'black');
      const board2 = new Board(19);
      board2.setStone(3, 3, 'black');
      expect(rule.isKoViolation(board1, board2, 5, 5)).toBe(true);
    });
    it('不同状态不违规', () => {
      const board1 = new Board(19);
      board1.setStone(3, 3, 'black');
      const board2 = new Board(19);
      board2.setStone(3, 3, 'white');
      expect(rule.isKoViolation(board1, board2, 5, 5)).toBe(false);
    });
    it('棋盘大小不同不违规', () => {
      const board1 = new Board(19);
      const board2 = new Board(9);
      expect(rule.isKoViolation(board1, board2, 3, 3)).toBe(false);
    });
  });

  describe('detectKo', () => {
    /**
     * 构造标准劫形（提子后状态）：
     *
     *       W
     *    W  B  W     黑(3,2)只有1气=空位(3,3)
     *    W  _  W     (3,3)是刚被提掉的白子位置
     *       B        黑(3,4)有3气
     *
     * 白方在(3,3)落子后，黑(3,2)0气→提1子→是劫
     */
    function createKoBoard(): { board: Board; koPos: { x: number; y: number } } {
      const board = new Board(19);
      board.setStone(3, 1, 'white');  // 上方白
      board.setStone(2, 2, 'white');  // 左方白
      board.setStone(4, 2, 'white');  // 右方白
      board.setStone(3, 2, 'black');  // 黑子（刚落的，只1气）
      board.setStone(2, 3, 'white');  // 左方白
      board.setStone(4, 3, 'white');  // 右方白
      board.setStone(3, 4, 'black');  // 下方黑子
      // (3,3) 是空的（刚被提掉的白子位置）
      return { board, koPos: { x: 3, y: 3 } };
    }

    /**
     * 构造打二还一棋形（提子后状态）：
     *
     *       W
     *    W  B  W     黑(3,2)只有1气=空位(3,3)
     *    W  _  W     (3,3)是刚被提掉的白子位置
     *       B        黑(3,4)
     *       B        黑(3,5) — 黑(3,4)(3,5)连通，只有1气=空位(3,3)
     *    W  B  W     黑(3,6) — 不对，让黑子连成3子
     *       W
     *
     * 实际上打二还一是：
     * 白在(3,3)落子后能提掉(3,2)这1子+黑(3,4)(3,5)...这不对
     *
     * 重新理解打二还一：
     * 黑提白1子→白马上提回黑2子以上（不是1子）
     * 关键：白落子后提的不是1子，所以不形成劫
     */
    function createSnapbackBoard(): { board: Board; koPos: { x: number; y: number } } {
      const board = new Board(19);
      // 黑在(3,2)落子提掉(3,3)的白子
      // 此时(3,3)空，(3,2)黑只有1气
      board.setStone(3, 1, 'white');
      board.setStone(2, 2, 'white');
      board.setStone(4, 2, 'white');
      board.setStone(3, 2, 'black');
      board.setStone(2, 3, 'white');
      board.setStone(4, 3, 'white');
      // 但(3,4)没有黑子，而是有两个连着的黑子被白围住
      // 白在(3,3)落子后，黑(3,2)0气被提
      // 但同时(3,4)(3,5)这两个黑子也只有(3,3)这一个气
      // 所以白在(3,3)落子后可以提3个黑子→不是劫
      board.setStone(3, 4, 'black');
      board.setStone(3, 5, 'black');
      board.setStone(2, 4, 'white');
      board.setStone(4, 4, 'white');
      board.setStone(2, 5, 'white');
      board.setStone(4, 5, 'white');
      board.setStone(3, 6, 'white');
      return { board, koPos: { x: 3, y: 3 } };
    }

    it('标准劫形：提1子且对方只能提回1子→是劫', () => {
      const { board, koPos } = createKoBoard();
      const result = rule.detectKo(board, 1, createCoordinate(koPos.x, koPos.y), 'black');
      expect(result.isActive).toBe(true);
      expect(result.forbiddenPosition?.x).toBe(koPos.x);
      expect(result.forbiddenPosition?.y).toBe(koPos.y);
    });

    it('打二还一：提1子但对方能提回多于1子→不是劫', () => {
      const { board, koPos } = createSnapbackBoard();
      const result = rule.detectKo(board, 1, createCoordinate(koPos.x, koPos.y), 'black');
      expect(result.isActive).toBe(false);
      expect(result.forbiddenPosition).toBe(null);
    });

    it('提多子不形成劫', () => {
      const board = new Board(19);
      const pos = createCoordinate(3, 3);
      const result = rule.detectKo(board, 2, pos, 'black');
      expect(result.isActive).toBe(false);
      expect(result.forbiddenPosition).toBe(null);
    });

    it('提零子不形成劫', () => {
      const board = new Board(19);
      const pos = createCoordinate(3, 3);
      const result = rule.detectKo(board, 0, pos, 'black');
      expect(result.isActive).toBe(false);
    });

    it('对方在被提位置无法提子→不是劫', () => {
      const board = new Board(19);
      const pos = createCoordinate(3, 3);
      const result = rule.detectKo(board, 1, pos, 'black');
      expect(result.isActive).toBe(false);
    });
  });
});
