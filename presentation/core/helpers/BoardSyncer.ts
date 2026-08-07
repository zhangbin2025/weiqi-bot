/**
 * 棋盘同步器
 * @description 同步Game状态到WebBoard显示
 * @module presentation/core/helpers/BoardSyncer
 */
import type { WebBoard } from '../../adapters/web/components/Board';
import type { Game } from '../../../domain/game';
import type { PlayerColor } from '../../../domain/primitives';
import type { MoveNumber } from './BoardRebuilder';
/**
 * 棋盘同步器
 * @description 同步Game状态到WebBoard显示
 */
export class BoardSyncer {
  /**
   * 同步棋盘显示
   * @param board - WebBoard组件
   * @param game - Game模型
   * @param moveNumbers - 手数标记列表
   * @param showMoveNumbers - 是否显示手数
   */
  static sync(
    board: WebBoard,
    game: Game,
    moveNumbers: MoveNumber[],
    showMoveNumbers: boolean
  ): void {
    const state = game.getState();
    const gameBoard = game.getBoard();
    const size = gameBoard.size;
    // 同步棋子
    const stones: Array<{ pos: { x: number; y: number }; color: PlayerColor | null }> = [];
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        const stone = gameBoard.getStone(x, y);
        if (stone) {
          stones.push({ pos: { x, y }, color: stone });
        }
      }
    }
    board.setStones(stones);
    // 高亮最后一手（显示手数时不显示）
    board.clearHighlight();
    if (state.lastMove && !showMoveNumbers) {
      board.highlight(state.lastMove, 'last');
    }
    // 显示手数
    if (showMoveNumbers && moveNumbers.length > 0) {
      board.setMoveNumbers(
        moveNumbers.map(m => ({ pos: { x: m.x, y: m.y }, number: m.number }))
      );
    } else {
      board.setMoveNumbers([]);
    }
    // 渲染
    board.render();
  }
}
