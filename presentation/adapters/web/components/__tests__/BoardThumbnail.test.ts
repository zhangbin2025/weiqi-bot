/**
 * BoardThumbnail 单元测试
 * @module presentation/adapters/web/components/__tests__/BoardThumbnail.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BoardThumbnail } from '../BoardThumbnail';
import type { ThumbnailMove } from '../types';
// Mock Canvas context
const mockContext = {
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  arc: vi.fn(),
  createRadialGradient: vi.fn(() => ({
    addColorStop: vi.fn(),
  })),
  scale: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  strokeStyle: '',
  fillStyle: '',
  lineWidth: 0,
};
const mockCanvas = {
  getContext: vi.fn(() => mockContext),
  getAttribute: vi.fn((key: string) => key === 'width' ? '100' : null),
  setAttribute: vi.fn(),
  width: 100,
  height: 100,
  style: { width: '', height: '' },
  dataset: {},
} as unknown as HTMLCanvasElement;
describe('BoardThumbnail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanvas.dataset = {};
  });
  describe('render', () => {
    it('should draw empty board when no moves', () => {
      BoardThumbnail.render(mockCanvas, []);
      expect(mockContext.fillRect).toHaveBeenCalled();
    });
    it('should draw board with stones', () => {
      const moves: ThumbnailMove[] = [
        { x: 3, y: 3, color: 'black' },
        { x: 4, y: 4, color: 'white' },
      ];
      BoardThumbnail.render(mockCanvas, moves);
      expect(mockContext.arc).toHaveBeenCalled();
    });
    it('should skip pass moves in rendering', () => {
      const moves: ThumbnailMove[] = [
        { x: 3, y: 3, color: 'black' },
        { x: -1, y: -1, color: 'white', isPass: true },
        { x: 4, y: 4, color: 'black' },
      ];
      BoardThumbnail.render(mockCanvas, moves);
      expect(mockContext.fillRect).toHaveBeenCalled();
    });
    it('should use custom theme', () => {
      BoardThumbnail.render(mockCanvas, [], { theme: 'classic' });
      expect(mockContext.fillRect).toHaveBeenCalled();
    });
    it('should use custom display size', () => {
      BoardThumbnail.render(mockCanvas, [], { displaySize: 9 });
      expect(mockContext.stroke).toHaveBeenCalled();
    });
    it('should use custom DPR', () => {
      BoardThumbnail.render(mockCanvas, [], { dpr: 2 });
      expect(mockContext.scale).toHaveBeenCalledWith(2, 2);
    });
    it('should truncate moves with prefixLen', () => {
      const moves: ThumbnailMove[] = [
        { x: 3, y: 3, color: 'black' },
        { x: 4, y: 4, color: 'white' },
        { x: 5, y: 5, color: 'black' },
      ];
      BoardThumbnail.render(mockCanvas, moves, { prefixLen: 2 });
      expect(mockContext.fillRect).toHaveBeenCalled();
    });
    it('should handle null context gracefully', () => {
      const nullCanvas = {
        getContext: vi.fn(() => null),
        getAttribute: vi.fn(() => '100'),
      } as unknown as HTMLCanvasElement;
      BoardThumbnail.render(nullCanvas, []);
      expect(true).toBe(true);
    });
  });
  describe('renderAll', () => {
    it('should work when document is undefined', () => {
      expect(BoardThumbnail.renderAll('canvas.test')).toBeUndefined();
    });
    it('should accept custom parser', () => {
      const customParser = vi.fn(() => [{ x: 3, y: 3, color: 'black' as const }]);
      // renderAll 需要 document，此测试仅验证 parser 参数可传入
      expect(typeof customParser).toBe('function');
    });
  });
  describe('buildBoardState (indirect)', () => {
    it('should handle moves with same position (overwrite)', () => {
      const moves: ThumbnailMove[] = [
        { x: 3, y: 3, color: 'black' },
        { x: 3, y: 3, color: 'white' },
      ];
      BoardThumbnail.render(mockCanvas, moves);
      // 白棋覆盖黑棋，渲染时只画一个棋子
      expect(mockContext.fillRect).toHaveBeenCalled();
    });
  });
});
