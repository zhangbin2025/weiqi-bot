/**
 * SGF 变化图和胜率提取
 * @module domain/sgf/SGFVariationExtractor
 */

import type { ISGFNode } from './types';
import type { ISGFVariation, VariationMove, WinratePoint } from './SGFVariationTypes';

/**
 * 提取变化图
 */
export function extractVariations(tree: ISGFNode): Record<number, ISGFVariation[]> {
  const variations: Record<number, ISGFVariation[]> = {};

  const traverse = (node: ISGFNode, moveNum: number): void => {
    if (node.children.length === 0) return;

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]!;

      // 收集这个分支的着法
      const childMoves: VariationMove[] = [];
      let current: ISGFNode | undefined = child;

      while (current) {
        if (current.color && current.coord) {
          childMoves.push({ color: current.color, coord: current.coord });
        }
        current = current.children[0];
      }

      // i > 0 表示这是变化分支
      if (i > 0 && childMoves.length > 0) {
        if (!variations[moveNum]) {
          variations[moveNum] = [];
        }

        // 提取注释
        let comment = '';
        const cProp = child.properties['C'];
        if (cProp !== undefined) {
          comment = Array.isArray(cProp) ? (cProp[0] ?? '') : String(cProp);
        }

        const name = `变化${variations[moveNum].length + 1}`;
        variations[moveNum].push({ name, moves: childMoves, comment });
      }

      const nextMoveNum = child.color && child.coord ? moveNum + 1 : moveNum;
      traverse(child!, nextMoveNum);
    }
  };

  traverse(tree, 0);
  return variations;
}

/**
 * 提取胜率
 */
export function extractWinrates(tree: ISGFNode): WinratePoint[] {
  const winrates: WinratePoint[] = [];

  const traverse = (node: ISGFNode): void => {
    const cProp = node.properties['C'];
    if (cProp !== undefined) {
      const comment = Array.isArray(cProp) ? (cProp[0] ?? '') : String(cProp);
      const winrate = parseWinrateComment(comment, node.moveNumber);
      if (winrate) {
        winrates.push(winrate);
      }
    }

    for (const child of node.children) {
      traverse(child);
    }
  };

  traverse(tree);
  return winrates;
}

/**
 * 解析胜率注释（野狐/KataGo/星阵格式）
 */
function parseWinrateComment(comment: string, moveNumber: number): WinratePoint | null {
  // 野狐格式: "黑65.3%" 或 "白48.2%"
  const foxwqMatch = comment.match(/([黑白])(\d+\.?\d*)%/);
  if (foxwqMatch && foxwqMatch[1] && foxwqMatch[2]) {
    const color = foxwqMatch[1] === '黑' ? 'black' : 'white';
    const winrate = parseFloat(foxwqMatch[2]);
    return { moveNumber, color, winrate, comment };
  }

  // KataGo 格式: "B 65.3%" 或 "W 48.2%"
  const katagoMatch = comment.match(/(B|W)\s+(\d+\.?\d*)%/);
  if (katagoMatch && katagoMatch[1] && katagoMatch[2]) {
    const color = katagoMatch[1] === 'B' ? 'black' : 'white';
    const winrate = parseFloat(katagoMatch[2]);
    return { moveNumber, color, winrate, comment };
  }

  // 星阵格式: "胜率:黑 65.3%"
  const xingzhenMatch = comment.match(/胜率[:\s]*([黑白])\s*(\d+\.?\d*)%/);
  if (xingzhenMatch && xingzhenMatch[1] && xingzhenMatch[2]) {
    const color = xingzhenMatch[1] === '黑' ? 'black' : 'white';
    const winrate = parseFloat(xingzhenMatch[2]);
    return { moveNumber, color, winrate, comment };
  }

  return null;
}
