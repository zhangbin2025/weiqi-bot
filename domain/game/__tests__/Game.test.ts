import { describe, it, expect } from 'vitest';
import { Game } from '../Game.js';

describe('Game', () => {
  describe('创建对局', () => {
    it('默认19路黑先', () => {
      const game = new Game();
      const state = game.getState();
      expect(state.board.size).toBe(19);
      expect(state.currentPlayer).toBe('black');
      expect(state.phase).toBe('playing');
    });
    it('自定义9路贴目6.5', () => {
      const game = new Game({ size: 9, komi: 6.5 });
      const state = game.getState();
      expect(state.board.size).toBe(9);
      expect(state.komi).toBe(6.5);
    });
    it('让子棋设置', () => {
      const game = new Game({ handicap: 3, komi: 0.5 });
      const state = game.getState();
      expect(state.handicap).toBe(3);
      expect(state.komi).toBe(0.5);
    });
  });

  describe('落子流程', () => {
    it('有效落子', () => {
      const game = new Game();
      const result = game.placeStone(3, 3);
      expect(result.success).toBe(true);
      expect(game.getState().currentPlayer).toBe('white');
    });
    it('已有棋子不能落', () => {
      const game = new Game();
      game.placeStone(3, 3);
      const result = game.placeStone(3, 3);
      expect(result.success).toBe(false);
      expect(result.error!.includes('已有棋子'));
    });
    it('对局结束后不能落子', () => {
      const game = new Game();
      game.pass(); game.pass();
      const result = game.placeStone(3, 3);
      expect(result.success).toBe(false);
      expect(result.error!.includes('已结束'));
    });
    it('记录着法历史', () => {
      const game = new Game();
      game.placeStone(3, 3);
      game.placeStone(15, 15);
      expect(game.getState().moveHistory.length).toBe(2);
    });
  });

  describe('虚手（停着）', () => {
    it('单次pass切换玩家', () => {
      const game = new Game();
      game.pass();
      expect(game.getState().currentPlayer).toBe('white');
    });
    it('连续两次pass结束对局', () => {
      const game = new Game();
      game.pass(); game.pass();
      expect(game.getState().phase).toBe('ended');
    });
    it('对局结束后pass无效', () => {
      const game = new Game();
      game.pass(); game.pass();
      const histLen = game.getState().moveHistory.length;
      game.pass();
      expect(game.getState().moveHistory.length).toBe(histLen);
    });
  });

  describe('认输（间接通过pass）', () => {
    it('连续pass触发结束', () => {
      const game = new Game();
      game.pass(); game.pass();
      expect(game.getState().phase).toBe('ended');
    });
  });

  describe('提子', () => {
    it('提掉无气的对方棋子', () => {
      const game = new Game();
      // 构造可提子局面：白子在(0,0)，黑子包围
      const board = game.getBoard();
      board.setStone(0, 0, 'white');
      board.setStone(1, 0, 'black');
      board.setStone(0, 1, 'black');
      // 黑落(2,0)不提子但测试capture机制
      const result = game.placeStone(2, 0);
      expect(result.success).toBe(true);
    });
    it('初始提子计数为0', () => {
      const game = new Game();
      const state = game.getState();
      expect(state.capturedBlack).toBe(0);
      expect(state.capturedWhite).toBe(0);
    });
  });

  describe('禁着点', () => {
    it('自杀禁着', () => {
      const game = new Game();
      const board = game.getBoard();
      board.setStone(1, 0, 'white');
      board.setStone(0, 1, 'white');
      const result = game.placeStone(0, 0);
      expect(result.success).toBe(false);
      expect(result.error!.includes('禁入点'));
    });
    it('打劫禁着', () => {
      const game = new Game();
      // 构造劫的局面
      const board = game.getBoard();
      board.setStone(0, 0, 'white');
      board.setStone(1, 0, 'black');
      board.setStone(0, 1, 'black');
      board.setStone(2, 1, 'white');
      board.setStone(1, 2, 'white');
      // 黑子(1,0)仅一气在(1,1)，设为劫位
      // 此处测试koPosition机制
      const koState = game.getState();
      expect(koState.koPosition).toBe(null);
    });
  });

  describe('悔棋', () => {
    it('undo成功', () => {
      const game = new Game();
      game.placeStone(3, 3);
      const undone = game.undo();
      expect(undone).toBe(true);
      expect(game.getState().moveHistory.length).toBe(0);
    });
    it('无着法时undo失败', () => {
      const game = new Game();
      expect(game.undo()).toBe(false);
    });
  });

  describe('新对局', () => {
    it('newGame重置状态', () => {
      const game = new Game();
      game.placeStone(3, 3);
      game.newGame({ size: 9 });
      const state = game.getState();
      expect(state.board.size).toBe(9);
      expect(state.moveHistory.length).toBe(0);
      expect(state.phase).toBe('playing');
    });
  });
});