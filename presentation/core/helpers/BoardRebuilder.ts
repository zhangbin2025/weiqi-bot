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
  /**
   * 重建棋盘状态
   * @param game - 棋局模型
   * @param replayData - 棋谱数据
   * @param path - 路径
   * @param targetIndex - 目标手数
   * @param options - 选项
   * @returns 手数标记列表
   */
  static rebuild(
    game: Game,
    replayData: ReplayData,
    path: number[],
    targetIndex: number,
    options: RebuildOptions = {}
  ): MoveNumber[] {
    const size = replayData.board_size as 9 | 13 | 19;
    game.newGame({ size });
    
    // 放置让子棋子（使用 stone.color 指定的颜色）
    if (options.handicapStones && options.handicapStones.length > 0) {
      game.setHandicapStones(options.handicapStones);
    }
    // 收集着法序列
    let node = replayData.tree;
    const moveNumbers: MoveNumber[] = [];
    // 记录变化分支起点的索引
    const variationStartIndex = options.inVariation ? (options.variationStartIndex ?? -1) : -1;
    let moveCounter = 0;
    // 在变化图模式下，计算变化分支的起始路径索引
    // 变化分支的起点是 path 的最后一个元素（即 path.length - 1）
    const variationStartPathIndex = options.inVariation ? path.length - 1 : -1;
    // 第一步：沿着 path 遍历树
    for (let i = 0; i < path.length; i++) {
      const index = path[i]!;
      if (!node.children || node.children.length <= index) {
        break;
      }
      node = node.children[index]!;
      if (node.color) {
        const pos = node.coord ? coordToPos(node.coord) : null;
        if (pos) {
          // 正常落子
          game.placeStone(pos.x, pos.y);
          moveCounter++;
          if (options.inVariation && i >= variationStartPathIndex) {
            const variationMoveNum = i - variationStartPathIndex + 1;
            moveNumbers.push({ x: pos.x, y: pos.y, number: variationMoveNum });
          } else if (!options.inVariation) {
            moveNumbers.push({ x: pos.x, y: pos.y, number: moveCounter });
          }
        } else {
          // Pass（停一手）
          game.pass();
          moveCounter++;
        }
      }
    }
    // 第二步：沿着主分支走 targetIndex 步（包括 Pass）
    // 注意：在变化图模式下，path 不包含变化分支的后续着法，所以需要单独计算
    if (options.inVariation) {
      // 变化图模式：沿着当前分支走 targetIndex 步
      for (let step = 0; step < targetIndex && node.children && node.children.length > 0; step++) {
        node = node.children[0]!;
        if (node.color) {
          const pos = node.coord ? coordToPos(node.coord) : null;
          if (pos) {
            // 正常落子
            game.placeStone(pos.x, pos.y);
            moveCounter++;
            // 手数编号：基于变化分支起点计算
            const variationMoveNum = moveNumbers.length + 1;
            moveNumbers.push({ x: pos.x, y: pos.y, number: variationMoveNum });
          } else {
            // Pass（停一手）
            game.pass();
            moveCounter++;
          }
        }
      }
    } else {
      // 主分支模式：沿着主分支走，直到达到 targetIndex
      while (moveCounter < targetIndex && node.children && node.children.length > 0) {
        node = node.children[0]!;
        if (node.color) {
          const pos = node.coord ? coordToPos(node.coord) : null;
          if (pos) {
            // 正常落子
            game.placeStone(pos.x, pos.y);
            moveCounter++;
            moveNumbers.push({ x: pos.x, y: pos.y, number: moveCounter });
          } else {
            // Pass（停一手）
            game.pass();
            moveCounter++;
            // Pass 不显示手数标记
          }
        }
      }
    }
    return moveNumbers;
  }
}
