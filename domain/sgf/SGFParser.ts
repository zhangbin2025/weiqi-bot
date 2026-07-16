/**
 * SGF 树状解析器 - 主入口
 * @module domain/sgf/SGFParser
 */

import type {
  ISGFParseResult,
  ISGFNode,
  ISGFGameInfoFull,
  ISGFStats,
  SGFProperties,
  HandicapStone,
} from './types';
import type { ISGFVariation, VariationMove, WinratePoint } from './SGFVariationTypes';
import { parseTree } from './SGFTreeParser';
import { SGFNodeInternal } from './SGFNodeInternal';
import { calcStats, nodeToDict } from './SGFStatsCalculator';
import { extractVariations, extractWinrates } from './SGFVariationExtractor';

// Re-export types
export type { ISGFNode } from './types';

/**
 * 将 SGF 坐标 (如 'pd') 转换为数字坐标
 */
export function coordToPos(coord: string): { x: number; y: number } | null {
  if (!coord || coord.length < 2) return null;
  const x = coord.charCodeAt(0) - 97;
  const y = coord.charCodeAt(1) - 97;
  return { x, y };
}

/**
 * 将数字坐标转换为 SGF 坐标
 */
export function posToCoord(x: number, y: number): string {
  return String.fromCharCode(97 + x) + String.fromCharCode(97 + y);
}

/**
 * SGF 解析器实现
 */
export class SGFParser {
  private errors: string[] = [];

  /**
   * 解析 SGF 文本
   */
  parse(sgf: string): ISGFParseResult {
    this.errors = [];
    const content = sgf.trim();

    if (!content) {
      this.errors.push('SGF内容为空');
      return this.createEmptyResult();
    }

    try {
      const rootNode = parseTree(content, this.errors);
      const tree = nodeToDict(rootNode);
      const stats = calcStats(tree);
      const gameInfo = this.extractGameInfo(tree);
      const moves = this.extractMainMoves(tree);
      const variations = extractVariations(tree);
      const winrates = extractWinrates(tree);

      return {
        gameInfo,
        tree,
        stats,
        moves,
        variations,
        winrates,
        errors: this.errors,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.errors.push(`解析错误: ${msg}`);
      return this.createEmptyResult();
    }
  }

  /**
   * 解析 SGF 文件
   */
  parseFile(filepath: string): ISGFParseResult {
    throw new Error('parseFile 需要在 Node.js 环境中使用 fs 模块');
  }

  private createEmptyResult(): ISGFParseResult {
    const emptyTree: ISGFNode = {
      properties: {},
      isRoot: true,
      moveNumber: 0,
      color: null,
      coord: null,
      children: [],
    };
    return {
      gameInfo: this.extractGameInfo(emptyTree),
      tree: emptyTree,
      stats: { totalNodes: 1, moveNodes: 0, maxDepth: 0, branchCount: 0 },
      moves: [],
      variations: {},
      winrates: [],
      errors: this.errors,
    };
  }

  private extractGameInfo(tree: ISGFNode): ISGFGameInfoFull {
    const props = tree.properties;
    const childProps = tree.children[0]?.properties || {};

    const getProp = (key: string, defaultVal: string = ''): string => {
      const val = props[key] ?? childProps[key] ?? defaultVal;
      if (Array.isArray(val) && val.length > 0 && val[0]) return val[0];
      return val ? String(val) : defaultVal;
    };

    const boardSize = parseInt(getProp('SZ', '19'), 10) || 19;
    const handicap = parseInt(getProp('HA', '0'), 10) || 0;
    const handicapStones: HandicapStone[] = [];

    // 解析 AB[] (添加黑子)
    const abProp = props['AB'] ?? childProps['AB'];
    if (abProp) {
      const coords = Array.isArray(abProp) ? abProp : [abProp];
      for (const coord of coords) {
        if (coord && coord.length >= 2) {
          const x = coord.charCodeAt(0) - 97;
          const y = coord.charCodeAt(1) - 97;
          if (x >= 0 && x < boardSize && y >= 0 && y < boardSize) {
            handicapStones.push({ x, y, color: 'B' });
          }
        }
      }
    }

    // 解析 AW[] (添加白子)
    const awProp = props['AW'] ?? childProps['AW'];
    if (awProp) {
      const coords = Array.isArray(awProp) ? awProp : [awProp];
      for (const coord of coords) {
        if (coord && coord.length >= 2) {
          const x = coord.charCodeAt(0) - 97;
          const y = coord.charCodeAt(1) - 97;
          if (x >= 0 && x < boardSize && y >= 0 && y < boardSize) {
            handicapStones.push({ x, y, color: 'W' });
          }
        }
      }
    }

    return {
      boardSize,
      black: getProp('PB', '黑棋'),
      white: getProp('PW', '白棋'),
      blackRank: getProp('BR'),
      whiteRank: getProp('WR'),
      event: getProp('EV'),
      gameName: getProp('GN', '围棋棋谱'),
      date: getProp('DT'),
      result: getProp('RE'),
      komi: getProp('KM', '375'),
      handicap,
      handicapStones,
    };
  }

  private extractMainMoves(tree: ISGFNode): VariationMove[] {
    const moves: VariationMove[] = [];
    let node: ISGFNode | undefined = tree;

    while (node && node.children.length > 0) {
      node = node.children[0];
      if (node && node.color) {
        // 如果有 coord，添加正常着法
        // 如果没有 coord（Pass），添加空字符串作为 coord
        moves.push({ color: node.color, coord: node.coord || '' });
      }
    }

    return moves;
  }
}

/**
 * 解析 SGF 文本（便捷函数）
 */
export function parseSGF(sgf: string): ISGFParseResult {
  const parser = new SGFParser();
  return parser.parse(sgf);
}
