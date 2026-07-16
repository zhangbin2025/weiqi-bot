/**
 * 文本棋盘缩略图渲染 — presentation 适配层
 * @module presentation/adapters/cli/components/TextBoardThumbnail
 */
import type { IBoard } from '../../../../domain/board/IBoard';
import type { PlayerColor } from '../../../../domain/primitives';
import type {
  TextBoardSymbols,
  ThumbnailConfig,
  ThumbnailResult,
} from './TextBoardTypes';
/** 默认符号 */
const DEFAULT_SYMBOLS: TextBoardSymbols = {
  black: '●',
  white: '○',
  empty: '·',
  blackLast: '◉',
  whiteLast: '◎',
  starPoint: '∙',
};
/** 星位坐标 */
const STAR_POINTS: Record<number, Array<[number, number]>> = {
  9: [[2, 2], [2, 6], [4, 4], [6, 2], [6, 6]],
  13: [[3, 3], [3, 9], [6, 6], [9, 3], [9, 9]],
  19: [[3, 3], [3, 9], [3, 15], [9, 3], [9, 9], [9, 15], [15, 3], [15, 9], [15, 15]],
};
/** 获取星位集合 */
export function getStarSet(size: number): Set<string> {
  const points = STAR_POINTS[size] ?? [];
  return new Set(points.map(([x, y]) => `${x},${y}`));
}
/** 合并符号配置 */
export function mergeSymbols(partial?: Partial<TextBoardSymbols>): TextBoardSymbols {
  if (!partial) return { ...DEFAULT_SYMBOLS };
  return { ...DEFAULT_SYMBOLS, ...partial };
}
/** 选择棋子符号（考虑最后一手高亮） */
function stoneSymbol(
  stone: PlayerColor | null,
  isLast: boolean,
  sym: TextBoardSymbols,
  starSet: Set<string>,
  key: string,
): string {
  if (stone === 'black') return isLast ? sym.blackLast : sym.black;
  if (stone === 'white') return isLast ? sym.whiteLast : sym.white;
  return starSet.has(key) ? sym.starPoint : sym.empty;
}
/**
 * 文本棋盘缩略图渲染器
 */
export class TextBoardThumbnail {
  /**
   * 渲染缩略图（带边框，自动裁剪到棋子区域）
   */
  static renderThumbnail(
    board: IBoard,
    config?: ThumbnailConfig,
    caption?: string,
  ): ThumbnailResult {
    const margin = config?.cropMargin ?? 2;
    const maxSize = config?.maxSize ?? 21;
    const lastMove = config?.lastMove;
    const size = board.size;
    // 找棋子边界框
    let minX = size, minY = size, maxX = -1, maxY = -1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (board.getStone(x, y) !== null) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    let startX: number, startY: number, endX: number, endY: number;
    if (maxX === -1) {
      // 空棋盘：显示中心 9x9
      const center = Math.floor(size / 2);
      startX = Math.max(0, center - 4);
      startY = Math.max(0, center - 4);
      endX = Math.min(size - 1, center + 4);
      endY = Math.min(size - 1, center + 4);
    } else {
      startX = Math.max(0, minX - margin);
      startY = Math.max(0, minY - margin);
      endX = Math.min(size - 1, maxX + margin);
      endY = Math.min(size - 1, maxY + margin);
      // 限制最大尺寸
      const w = endX - startX + 1;
      const h = endY - startY + 1;
      if (w > maxSize) {
        const trim = Math.floor((w - maxSize) / 2);
        startX += trim;
        endX = startX + maxSize - 1;
      }
      if (h > maxSize) {
        const trim = Math.floor((h - maxSize) / 2);
        startY += trim;
        endY = startY + maxSize - 1;
      }
    }
    // 渲染裁剪区域
    const sym = mergeSymbols();
    const starSet = getStarSet(size);
    const lines: string[] = [];
    // 顶边框
    const boardW = endX - startX + 1;
    lines.push('┌' + '─'.repeat(boardW * 2 + 1) + '┐');
    for (let y = startY; y <= endY; y++) {
      const cells: string[] = [];
      for (let x = startX; x <= endX; x++) {
        const stone = board.getStone(x, y);
        const isLast = lastMove !== undefined && lastMove.x === x && lastMove.y === y;
        cells.push(stoneSymbol(stone, isLast, sym, starSet, `${x},${y}`));
      }
      lines.push('│ ' + cells.join(' ') + ' │');
    }
    lines.push('└' + '─'.repeat(boardW * 2 + 1) + '┘');
    if (caption) {
      lines.push(caption);
    }
    const region = { startX, startY, endX, endY };
    const result: ThumbnailResult = { text: lines.join('\n'), region };
    if (caption) result.caption = caption;
    return result;
  }
  /**
   * 渲染简单文本行（用于 JSON 输出，无坐标无边框）
   */
  static renderCompact(
    board: IBoard,
    symbols?: Partial<TextBoardSymbols>,
  ): string {
    const sym = mergeSymbols(symbols);
    const size = board.size;
    const starSet = getStarSet(size);
    const lines: string[] = [];
    for (let y = 0; y < size; y++) {
      const cells: string[] = [];
      for (let x = 0; x < size; x++) {
        const stone = board.getStone(x, y);
        cells.push(stoneSymbol(stone, false, sym, starSet, `${x},${y}`));
      }
      lines.push(cells.join(' '));
    }
    return lines.join('\n');
  }
}
