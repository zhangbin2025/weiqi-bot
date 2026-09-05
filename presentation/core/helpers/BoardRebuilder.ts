/**
 * 棋盘重建器
 * @description 根据路径和手数重建棋盘状态
 * @module presentation/core/helpers/BoardRebuilder
 */
import { coordToPos } from '../../../domain/sgf';
import type { Game } from '../../../domain/game';
import type { ReplayNode, ReplayData } from '../../../domain/sgf';

/** 手数标记 */
export interface MoveNumber {
  x: number;
  y: number;
  number: number;
}

/** 重建选项 */
export interface RebuildOptions {
  /** 让子位置 */
  handicapStones?: Array<{ x: number; y: number; color: 'B' | 'W' }> | undefined;
  /** 先手方 */
  initialPlayer?: 'black' | 'white' | undefined;
  /** 是否在变化图模式 */
  inVariation?: boolean;
  /** 变化图起始索引 */
  variationStartIndex?: number;
}

/**
 * 棋盘重建器
 * @description 根据路径和手数重建棋盘状态
 */
export class BoardRebuilder {
  static rebuild(
    game: Game,
    replayData: ReplayData,
    path: number[],
    targetIndex: number,
    options: RebuildOptions = {}
  ): MoveNumber[] {
    const size = replayData.board_size as 9 | 13 | 19;
    game.newGame({ size });
    
    // 放置让子棋子（会自动设置白先）
    if (options.handicapStones && options.handicapStones.length > 0) {
      game.setHandicapStones(options.handicapStones);
    }
    
    // 设置先手方（覆盖让子棋的默认白先）
    if (options.initialPlayer) {
      game.setInitialPlayer(options.initialPlayer);
    }
    
    // 收集着法序列
    let node = replayData.tree;
    const moveNumbers: MoveNumber[] = [];
    const variationStartIndex = options.inVariation ? (options.variationStartIndex ?? -1) : -1;
    let moveCounter = 0;
    const variationStartPathIndex = options.inVariation ? path.length - 1 : -1;
    
    // 第一步：沿着 path 遍历树
    for (let i = 0; i < path.length; i++) {
      const index = path[i]!;
      if (!node.children || node.children.length <= index) break;
      node = node.children[index]!;
      if (node.color) {
        const pos = node.coord ? coordToPos(node.coord) : null;
        if (pos && pos.x >= 0 && pos.x < size && pos.y >= 0 && pos.y < size) {
          game.placeStone(pos.x, pos.y);
          moveCounter++;
          if (options.inVariation && i >= variationStartPathIndex) {
            moveNumbers.push({ x: pos.x, y: pos.y, number: i - variationStartPathIndex + 1 });
          } else if (!options.inVariation) {
            moveNumbers.push({ x: pos.x, y: pos.y, number: moveCounter });
          }
        } else {
          game.pass();
          moveCounter++;
        }
      }
    }
    
    // 第二步：沿着主分支走 targetIndex 步
    if (options.inVariation) {
      for (let step = 0; step < targetIndex && node.children && node.children.length > 0; step++) {
        node = node.children[0]!;
        if (node.color) {
          const pos = node.coord ? coordToPos(node.coord) : null;
          if (pos && pos.x >= 0 && pos.x < size && pos.y >= 0 && pos.y < size) {
            game.placeStone(pos.x, pos.y);
            moveCounter++;
            moveNumbers.push({ x: pos.x, y: pos.y, number: moveNumbers.length + 1 });
          } else {
            game.pass();
            moveCounter++;
          }
        }
      }
    } else {
      while (moveCounter < targetIndex && node.children && node.children.length > 0) {
        node = node.children[0]!;
        if (node.color) {
          const pos = node.coord ? coordToPos(node.coord) : null;
          if (pos && pos.x >= 0 && pos.x < size && pos.y >= 0 && pos.y < size) {
            game.placeStone(pos.x, pos.y);
            moveCounter++;
            moveNumbers.push({ x: pos.x, y: pos.y, number: moveCounter });
          } else {
            game.pass();
            moveCounter++;
          }
        }
      }
    }
    
    return moveNumbers;
  }
}
