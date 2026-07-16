/**
 * @fileoverview 人机对弈工具函数
 */

import type { IBoard, PlayerColor, BoardState, MoveOrPass } from '../../../domain';
import { createEmptyBoardState, isPass } from '../../../domain';

/** 从 IBoard 获取 BoardState */
export function getBoardState(board: IBoard): BoardState {
  const size = board.size;
  const state = createEmptyBoardState(size);
  for (let y = 0; y < size; y++) {
    const row = state[y];
    if (!row) continue;
    for (let x = 0; x < size; x++) {
      row[x] = board.getStone(x, y);
    }
  }
  return state;
}

/** 转换 MoveOrPass 为简单格式 */
export function toSimpleMove(m: MoveOrPass): { x: number; y: number; player: PlayerColor } | null {
  if (isPass(m)) {
    // Pass 使用特殊坐标 (-1, -1) 传给 KataGo
    return { x: -1, y: -1, player: m.color };
  }
  return { x: m.x, y: m.y, player: m.color };
}
