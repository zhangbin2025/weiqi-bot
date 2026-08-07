import { describe, it, beforeEach, expect } from 'vitest';
import { BoardController } from '../BoardController';
function createMockBoard() {
  const log: string[] = [];
  return {
    log,
    on: () => { log.push('on'); },
    setStones: () => { log.push('setStones'); },
    clearHighlight: () => { log.push('clearHighlight'); },
    highlight: () => { log.push('highlight'); },
    clear: () => { log.push('clear'); },
    render: () => { log.push('render'); },
    destroy: () => { log.push('destroy'); },
  };
}
function createMockGame(overrides: Record<string, unknown> = {}) {
  return {
    placeStone: () => ({ success: true }),
    getState: () => ({ lastMove: null }),
    getBoard: () => ({
      size: 9,
      getPoint: () => null,
    }),
    undo: () => true,
    newGame: () => {},
    pass: () => {},
    ...overrides,
  };
}
describe('BoardController', () => {
  let ctrl: BoardController;
  beforeEach(() => {
    ctrl = new BoardController(
      createMockBoard() as any,
      createMockGame() as any
    );
  });
  it('should be constructed with board and game', () => {
    expect(ctrl instanceof BoardController);
  });
  it('bindEvents() should register click handler', () => {
    const board = createMockBoard();
    const ctrl2 = new BoardController(board as any, createMockGame() as any);
    ctrl2.bindEvents();
    expect(board.log.includes('on'));
  });
  it('updateBoard() should set stones on board', () => {
    const board = createMockBoard();
    const ctrl2 = new BoardController(board as any, createMockGame() as any);
    ctrl2.updateBoard();
    expect(board.log.includes('setStones'));
  });
  it('updateBoard() should highlight lastMove when present', () => {
    const board = createMockBoard();
    const game = createMockGame({
      getState: () => ({ lastMove: { x: 3, y: 3 } }),
    });
    const ctrl2 = new BoardController(board as any, game as any);
    ctrl2.updateBoard();
    expect(board.log.includes('clearHighlight'));
    expect(board.log.includes('highlight'));
  });
  it('undo() should call game.undo and update board', () => {
    const board = createMockBoard();
    const game = createMockGame({ undo: () => true });
    const ctrl2 = new BoardController(board as any, game as any);
    ctrl2.undo();
    expect(board.log.includes('setStones'));
  });
  it('undo() should not update when game.undo returns false', () => {
    const board = createMockBoard();
    const game = createMockGame({ undo: () => false });
    const ctrl2 = new BoardController(board as any, game as any);
    ctrl2.undo();
    expect(!board.log.includes('setStones'));
  });
  it('newGame() should clear and render board', () => {
    const board = createMockBoard();
    const ctrl2 = new BoardController(board as any, createMockGame() as any);
    ctrl2.newGame();
    expect(board.log.includes('clear'));
    expect(board.log.includes('render'));
  });
  it('pass() should call game.pass and update board', () => {
    const board = createMockBoard();
    let called = false;
    const game = createMockGame({ pass: () => { called = true; } });
    const ctrl2 = new BoardController(board as any, game as any);
    ctrl2.pass();
    expect(called);
    expect(board.log.includes('setStones'));
  });
  it('resign() should clear and render board', () => {
    const board = createMockBoard();
    const ctrl2 = new BoardController(board as any, createMockGame() as any);
    ctrl2.resign();
    expect(board.log.includes('clear'));
    expect(board.log.includes('render'));
  });
  it('destroy() should call board.destroy', () => {
    const board = createMockBoard();
    const ctrl2 = new BoardController(board as any, createMockGame() as any);
    ctrl2.destroy();
    expect(board.log.includes('destroy'));
  });
});
