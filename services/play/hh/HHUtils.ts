/**
 * @fileoverview 真人对弈工具函数
 */

import type { IBoard, PlayerColor, BoardState, MoveOrPass } from '../../../domain';
import { isPass } from '../../../domain';

/** 从 IBoard 获取 BoardState */
export function getBoardState(board: IBoard): BoardState {
  const size = board.size;
  const state: BoardState = [];
  for (let y = 0; y < size; y++) {
    const row: (PlayerColor | null)[] = [];
    for (let x = 0; x < size; x++) {
      row.push(board.getStone(x, y));
    }
    state.push(row);
  }
  return state;
}

/** 转换 MoveOrPass 为简单格式 */
export function toSimpleMove(m: MoveOrPass): { x: number; y: number; player: PlayerColor } | null {
  if (isPass(m)) return null;
  return { x: m.x, y: m.y, player: m.color };
}
