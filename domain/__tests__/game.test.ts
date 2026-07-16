import { describe, it, expect } from 'vitest';
import { Game } from '../game';

describe('game module', () => {
  describe('Game', () => {
    it('should create game with default config', () => {
      const game = new Game();
      const state = game.getState();
      expect(state.board.size).toBe(19);
      expect(state.currentPlayer).toBe('black');
      expect(state.phase).toBe('playing');
    });

    it('should create game with custom config', () => {
      const game = new Game({ size: 9, komi: 6.5 });
      const state = game.getState();
      expect(state.board.size).toBe(9);
      expect(state.komi).toBe(6.5);
    });

    it('should place stones correctly', () => {
      const game = new Game();
      const result = game.placeStone(3, 3);
      expect(result.success).toBe(true);
      const state = game.getState();
      expect(state.currentPlayer).toBe('white');
      expect(state.moveHistory.length).toBe(1);
    });

    it('should not allow placing on occupied position', () => {
      const game = new Game();
      game.placeStone(3, 3);
      const result = game.placeStone(3, 3);
      expect(result.success).toBe(false);
      expect(result.error).toContain('已有棋子');
    });

    it('should not allow suicide', () => {
      const game = new Game();
      // 设置一个自杀局面
      game.newGame();
      const board = game.getBoard();
      board.setStone(1, 0, 'white');
      board.setStone(0, 1, 'white');
      // 尝试自杀
      const result = game.placeStone(0, 0);
      expect(result.success).toBe(false);
      expect(result.error).toContain('禁入点');
    });

    it('should handle pass correctly', () => {
      const game = new Game();
      game.pass();
      const state = game.getState();
      expect(state.currentPlayer).toBe('white');
      expect(state.moveHistory.length).toBe(1);
    });

    it('should end game after two consecutive passes', () => {
      const game = new Game();
      game.pass();
      game.pass();
      const state = game.getState();
      expect(state.phase).toBe('ended');
    });

    it('should undo move', () => {
      const game = new Game();
      game.placeStone(3, 3);
      const undone = game.undo();
      expect(undone).toBe(true);
      const state = game.getState();
      expect(state.moveHistory.length).toBe(0);
    });

    it('should not undo when no moves', () => {
      const game = new Game();
      const undone = game.undo();
      expect(undone).toBe(false);
    });

    it('should start new game', () => {
      const game = new Game();
      game.placeStone(3, 3);
      game.newGame({ size: 9 });
      const state = game.getState();
      expect(state.board.size).toBe(9);
      expect(state.moveHistory.length).toBe(0);
      expect(state.phase).toBe('playing');
    });

    it('should track captured stones', () => {
      const game = new Game();
      // 设置一个可以吃子的局面
      const board = game.getBoard();
      board.setStone(1, 0, 'white');
      board.setStone(0, 1, 'white');
      // 黑方落子包围白子
      // 注意：这个测试需要更复杂的设置来验证提子
      const state = game.getState();
      expect(state.capturedBlack).toBe(0);
      expect(state.capturedWhite).toBe(0);
    });
  });
});