/**
 * 文本棋盘渲染器 — presentation 适配层
 * @module presentation/adapters/cli/components/TextBoardRenderer
 */
import type { IBoard } from '../../../../domain/board/IBoard';
import type { PlayerColor } from '../../../../domain/primitives';
import type {
  TextBoardConfig,
  TextBoardSymbols,
} from './TextBoardTypes';
import { getStarSet, mergeSymbols } from './TextBoardThumbnail';
/** 列标签：A-T 跳过 I（围棋标准） */
const COL_LABELS = 'ABCDEFGHJKLMNOPQRST';
/** 手数显示时用的数字符号（1-999） */
function moveNumberStr(n: number): string {
  if (n > 999) return '+++';
  return String(n);
}
/**
 * 文本棋盘渲染器
 */
export class TextBoardRenderer {
  /**
   * 渲染全量棋盘
   * @param board - 棋盘实例
   * @param config - 渲染配置
   * @param symbols - 符号配置
   * @param moveNumbers - 可选的手数映射 (x,y)→手数
   */
  static render(
    board: IBoard,
    config?: TextBoardConfig,
    symbols?: Partial<TextBoardSymbols>,
    moveNumbers?: Map<string, number>,
  ): string {
    const sym = mergeSymbols(symbols);
    const size = board.size;
    const showCoords = config?.showCoordinates ?? true;
    const showMoveNums = config?.showMoveNumbers ?? false;
    const lastMove = config?.lastMove;
    const starSet = getStarSet(size);
    const lines: string[] = [];
    // 列标签行
    if (showCoords) {
      const colLabels = COL_LABELS.slice(0, size).split('').join(' ');
      lines.push(`   ${colLabels}`);
    }
    for (let y = 0; y < size; y++) {
      const rowNumber = size - y;
      const cells: string[] = [];
      for (let x = 0; x < size; x++) {
        const stone: PlayerColor | null = board.getStone(x, y);
        const isLast = lastMove !== undefined && lastMove.x === x && lastMove.y === y;
        if (showMoveNums && moveNumbers) {
          const mn = moveNumbers.get(`${x},${y}`);
          if (mn !== undefined && stone !== null) {
            cells.push(moveNumberStr(mn));
            continue;
          }
        }
        if (stone === 'black') {
          cells.push(isLast ? sym.blackLast : sym.black);
        } else if (stone === 'white') {
          cells.push(isLast ? sym.whiteLast : sym.white);
        } else {
          cells.push(starSet.has(`${x},${y}`) ? sym.starPoint : sym.empty);
        }
      }
      const rowStr = cells.join(' ');
      if (showCoords) {
        const label = rowNumber.toString().padStart(2);
        lines.push(`${label} ${rowStr}`);
      } else {
        lines.push(rowStr);
      }
    }
    return lines.join('\n');
  }
}
