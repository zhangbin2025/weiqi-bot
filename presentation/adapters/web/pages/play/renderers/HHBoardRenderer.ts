/**
 * @fileoverview 棋盘渲染器 - 负责渲染棋盘和棋子
 * @description 封装棋盘的渲染逻辑
 */
import type { WebBoard } from '../../../components/Board';
import type { PlayerColor, Position } from '../../../../../core/types';
import type { IHHPlayState } from '../../../../../../services/play/hh/IHHPlayService';
/** 棋盘渲染器配置 */
export interface HHBoardRendererConfig {
  board: WebBoard;
}
/**
 * 棋盘渲染器
 * @description 负责渲染棋盘、棋子、预览和标记
 */
export class HHBoardRenderer {
  private board: WebBoard;
  constructor(config: HHBoardRendererConfig) {
    this.board = config.board;
  }
  /**
   * 渲染棋盘
   * @param state 游戏状态
   * @param selectedPosition 选中的位置
   * @param myColor 我的颜色
   */
  render(state: IHHPlayState, selectedPosition: Position | null, myColor: PlayerColor | undefined): void {
    this.board.clear();
    // 渲染棋子
    const stones: Array<{ pos: Position; color: PlayerColor | null }> = [];
    const boardData = state.board;
    const size = boardData.length;
    for (let y = 0; y < size; y++) {
      const row = boardData[y];
      if (!row) continue;
      for (let x = 0; x < row.length; x++) {
        const stone = row[x];
        if (stone) {
          stones.push({
            pos: { x, y },
            color: stone as PlayerColor
          });
        }
      }
    }
    this.board.setStones(stones);
    // 渲染预览棋子
    if (selectedPosition && myColor) {
      this.board.setPreviewStone(selectedPosition, myColor);
    } else {
      this.board.clearPreviewStone();
    }
    // 标记最后一手
    if (state.moveHistory.length > 0) {
      const lastMove = state.moveHistory[state.moveHistory.length - 1];
      if (lastMove) {
        this.board.highlight({ x: lastMove.x, y: lastMove.y }, 'last');
      }
    }
    this.board.render();
  }
}
