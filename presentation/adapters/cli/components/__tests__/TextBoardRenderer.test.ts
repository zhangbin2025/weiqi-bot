import { describe, it, expect } from 'vitest';
import { Board } from '../../../../../domain/board/Board';
import { TextBoardRenderer } from '../TextBoardRenderer';
import { TextBoardThumbnail } from '../TextBoardThumbnail';
describe('TextBoardRenderer', () => {
  describe('render - 空棋盘', () => {
    it('渲染 19 路空棋盘', () => {
      const board = new Board(19);
      const text = TextBoardRenderer.render(board);
      const lines = text.split('\n');
      // 1 行列标签 + 19 行棋盘
      expect(lines.length).toBe(20);
      // 列标签: A B C D E F G H J K L M N O P Q R S T (跳过 I)
      expect(lines[0]).toBe('   A B C D E F G H J K L M N O P Q R S T');
      // 第 19 行 (y=0)
      expect(lines[1]).toMatch(/^19 ·/);
      // 第 1 行 (y=18)
      expect(lines[19]).toMatch(/^ 1 ·/);
    });
    it('渲染 13 路空棋盘', () => {
      const board = new Board(13);
      const text = TextBoardRenderer.render(board);
      const lines = text.split('\n');
      expect(lines.length).toBe(14);
      // 列标签 13 列
      expect(lines[0]).toBe('   A B C D E F G H J K L M N');
    });
    it('渲染 9 路空棋盘', () => {
      const board = new Board(9);
      const text = TextBoardRenderer.render(board);
      const lines = text.split('\n');
      expect(lines.length).toBe(10);
      expect(lines[0]).toBe('   A B C D E F G H J');
    });
  });
  describe('render - 有棋子', () => {
    it('正确渲染黑子和白子', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      board.setStone(15, 3, 'white');
      const text = TextBoardRenderer.render(board, { showCoordinates: false });
      const lines = text.split('\n');
      const row3 = lines[3];
      expect(row3).toContain('●');
      expect(row3).toContain('○');
    });
    it('最后一手高亮', () => {
      const board = new Board(9);
      board.setStone(2, 2, 'black');
      board.setStone(4, 4, 'white');
      const text = TextBoardRenderer.render(board, {
        showCoordinates: false,
        lastMove: { x: 4, y: 4 },
      });
      const lines = text.split('\n');
      const row4 = lines[4];
      expect(row4).toContain('◎');
    });
    it('黑子最后一手高亮', () => {
      const board = new Board(9);
      board.setStone(2, 2, 'black');
      const text = TextBoardRenderer.render(board, {
        showCoordinates: false,
        lastMove: { x: 2, y: 2 },
      });
      const lines = text.split('\n');
      const row2 = lines[2];
      expect(row2).toContain('◉');
    });
  });
  describe('render - 坐标标注', () => {
    it('列标签跳过 I', () => {
      const board = new Board(19);
      const text = TextBoardRenderer.render(board);
      const colLine = text.split('\n')[0]!;
      expect(colLine).not.toContain('I ');
      const hIdx = colLine.indexOf('H');
      const jIdx = colLine.indexOf('J');
      expect(jIdx).toBeGreaterThan(hIdx);
    });
    it('行号从大到小', () => {
      const board = new Board(19);
      const text = TextBoardRenderer.render(board);
      const lines = text.split('\n');
      expect(lines[1]).toMatch(/^19 /);
      expect(lines[19]).toMatch(/^ 1 /);
    });
  });
  describe('render - 星位', () => {
    it('19 路棋盘空位星位显示星位符号', () => {
      const board = new Board(19);
      const text = TextBoardRenderer.render(board, { showCoordinates: false });
      const lines = text.split('\n');
      const row3 = lines[3]!;
      const cells = row3.split(' ');
      expect(cells[3]).toBe('∙');
    });
    it('9 路棋盘天元是星位', () => {
      const board = new Board(9);
      const text = TextBoardRenderer.render(board, { showCoordinates: false });
      const lines = text.split('\n');
      const row4 = lines[4]!.split(' ');
      expect(row4[4]).toBe('∙');
    });
    it('有棋子的星位显示棋子', () => {
      const board = new Board(19);
      board.setStone(3, 3, 'black');
      const text = TextBoardRenderer.render(board, { showCoordinates: false });
      const lines = text.split('\n');
      const row3 = lines[3]!.split(' ');
      expect(row3[3]).toBe('●');
    });
  });
  describe('render - 手数显示', () => {
    it('显示手数替代棋子符号', () => {
      const board = new Board(9);
      board.setStone(2, 2, 'black');
      board.setStone(4, 4, 'white');
      const moveNumbers = new Map<string, number>();
      moveNumbers.set('2,2', 1);
      moveNumbers.set('4,4', 2);
      const text = TextBoardRenderer.render(
        board,
        { showMoveNumbers: true, showCoordinates: false },
        undefined,
        moveNumbers,
      );
      const lines = text.split('\n');
      const row2 = lines[2]!.split(' ');
      expect(row2[2]).toBe('1');
      const row4 = lines[4]!.split(' ');
      expect(row4[4]).toBe('2');
    });
  });
  describe('render - 无坐标模式', () => {
    it('不显示坐标时没有行列标签', () => {
      const board = new Board(9);
      const text = TextBoardRenderer.render(board, { showCoordinates: false });
      const lines = text.split('\n');
      expect(lines.length).toBe(9);
      expect(lines[0]).not.toMatch(/^\d/);
    });
  });
});
describe('TextBoardThumbnail', () => {
  describe('renderThumbnail - 缩略图', () => {
    it('空棋盘显示中心区域', () => {
      const board = new Board(19);
      const result = TextBoardThumbnail.renderThumbnail(board);
      expect(result.text).toContain('┌');
      expect(result.text).toContain('┐');
      expect(result.region).toBeDefined();
    });
    it('有棋子时裁剪到棋子周围', () => {
      const board = new Board(19);
      board.setStone(10, 10, 'black');
      const result = TextBoardThumbnail.renderThumbnail(board);
      expect(result.region).toBeDefined();
      expect(result.region!.startX).toBe(8);
      expect(result.region!.startY).toBe(8);
      expect(result.region!.endX).toBe(12);
      expect(result.region!.endY).toBe(12);
    });
    it('带 caption 输出', () => {
      const board = new Board(9);
      board.setStone(4, 4, 'black');
      const caption = '第1手 黑 E5';
      const result = TextBoardThumbnail.renderThumbnail(board, undefined, caption);
      expect(result.text).toContain(caption);
      expect(result.caption).toBe(caption);
    });
    it('最后一手高亮黑子', () => {
      const board = new Board(9);
      board.setStone(4, 4, 'black');
      const result = TextBoardThumbnail.renderThumbnail(board, {
        lastMove: { x: 4, y: 4 },
      });
      expect(result.text).toContain('◉');
    });
    it('最后一手高亮白子', () => {
      const board = new Board(9);
      board.setStone(4, 4, 'white');
      const result = TextBoardThumbnail.renderThumbnail(board, {
        lastMove: { x: 4, y: 4 },
      });
      expect(result.text).toContain('◎');
    });
    it('非最后一手的棋子不高亮', () => {
      const board = new Board(9);
      board.setStone(2, 2, 'black');
      board.setStone(4, 4, 'white');
      const result = TextBoardThumbnail.renderThumbnail(board, {
        lastMove: { x: 4, y: 4 },
      });
      // 黑子(2,2) 应该用普通符号 ●，不是 ◉
      expect(result.text).toContain('●');
      // 白子(4,4) 应该用高亮符号 ◎
      expect(result.text).toContain('◎');
    });
  });
  describe('renderCompact - 紧凑格式', () => {
    it('9 路空棋盘紧凑输出', () => {
      const board = new Board(9);
      const text = TextBoardThumbnail.renderCompact(board);
      const lines = text.split('\n');
      expect(lines.length).toBe(9);
      expect(lines[0]!.split(' ').length).toBe(9);
    });
    it('有棋子的紧凑输出', () => {
      const board = new Board(9);
      board.setStone(0, 0, 'black');
      board.setStone(8, 8, 'white');
      const text = TextBoardThumbnail.renderCompact(board);
      const lines = text.split('\n');
      expect(lines[0]!.split(' ')[0]).toBe('●');
      expect(lines[8]!.split(' ')[8]).toBe('○');
    });
    it('自定义符号', () => {
      const board = new Board(9);
      board.setStone(0, 0, 'black');
      const text = TextBoardThumbnail.renderCompact(board, {
        black: 'X',
        white: 'O',
        empty: '.',
      });
      const lines = text.split('\n');
      expect(lines[0]!.split(' ')[0]).toBe('X');
    });
  });
});
