/**
 * SGF 转 ReplayData 转换器
 * @module domain/sgf/SGFToReplay
 */

import { SGFParser, type ISGFNode } from './SGFParser';
import type { HandicapStone } from './types';

export interface ReplayNode {
  color: 'B' | 'W' | null;
  coord: string | null;
  properties?: { C?: string; N?: string; [key: string]: string | undefined };
  children?: ReplayNode[];
}

export interface ReplayData {
  game_name: string;
  black: string;
  white: string;
  black_rank?: string | undefined;
  white_rank?: string | undefined;
  board_size: number;
  handicap?: number | undefined;
  handicap_stones?: Array<{ x: number; y: number; color: 'B' | 'W' }> | undefined;
  result?: string | undefined;
  tree: ReplayNode;
  download_filename?: string | undefined;
  default_move?: number | undefined;
  max_moves: number;
}

export interface SGFToReplayOptions {
  defaultMove?: number; // -1 表示最后一手
  gameName?: string;
  downloadFilename?: string;
}

/**
 * 判断错误是否为"已容错继续解析"类型
 * 解析器对这些错误已做了跳过/补全处理，不应阻止返回结果
 */
function isIgnorableError(error: string): boolean {
  // 跳过类错误：解析器跳过问题字符继续解析
  if (error.includes('跳过')) return true;
  // 截断类错误：属性值未闭合，解析器已尽最大努力解析
  if (error.includes('未闭合')) return true;
  // 多余类错误：多余字符被忽略
  if (error.includes('多余')) return true;
  // 警告类：已自动处理
  if (error.startsWith('警告:')) return true;
  // 解析异常：这是真正的致命错误（try-catch 捕获的异常）
  if (error.startsWith('解析错误:')) return false;
  // 空内容：这是致命错误
  if (error === 'SGF内容为空') return false;
  // 其他位置错误：解析器记录了位置但继续解析，可以容错
  if (error.includes('位置')) return true;
  return false;
}

/**
 * 将 SGF 内容转换为 ReplayData
 * @description 尽最大努力解析，只要有任何有效内容就返回结果
 */
export function sgfToReplayData(sgf: string, options?: SGFToReplayOptions): ReplayData | null {
  const parser = new SGFParser();
  const result = parser.parse(sgf);

  // 原则：尽可能解析，能解析多少算多少
  // 1. 分类错误：致命错误 vs 容错错误
  const fatalErrors = result.errors.filter(e => !isIgnorableError(e));
  const ignorableErrors = result.errors.filter(e => isIgnorableError(e));

  // 致命错误：解析器完全无法处理
  if (fatalErrors.length > 0) {
    console.warn('SGF 解析失败:', fatalErrors);
    // 但如果仍有有效内容，还是尝试返回
    const hasAnyContent = result.tree && result.tree.children.length > 0;
    if (!hasAnyContent) {
      return null;
    }
    // 有内容但有致命错误，记录警告后返回部分结果
    console.warn('虽然有致命错误，但仍返回已解析的部分结果');
  }

  // 检查是否有有效的解析结果
  // 有效内容：有根属性 或 有子节点
  const hasValidContent = result.tree && 
    (Object.keys(result.tree.properties).length > 0 || result.tree.children.length > 0);
  
  if (!hasValidContent) {
    return null;
  }

  // 有容错错误时打印警告
  if (ignorableErrors.length > 0) {
    console.warn('SGF 解析有以下问题（已容错处理）:', ignorableErrors);
  }

  const gameInfo = result.gameInfo;
  const maxMoves = countMoves(result.tree);

  // 处理 defaultMove
  let defaultMove: number;
  if (options?.defaultMove === -1 || options?.defaultMove === undefined) {
    defaultMove = maxMoves;
  } else {
    defaultMove = Math.min(options.defaultMove, maxMoves);
  }

  // 转换让子位置格式
  const handicapStones = gameInfo.handicapStones.map((s: HandicapStone) => ({
    x: s.x,
    y: s.y,
    color: s.color,
  }));

  return {
    game_name: options?.gameName || gameInfo.gameName || `${gameInfo.black} vs ${gameInfo.white}`,
    black: gameInfo.black,
    white: gameInfo.white,
    black_rank: gameInfo.blackRank,
    white_rank: gameInfo.whiteRank,
    board_size: gameInfo.boardSize,
    handicap: gameInfo.handicap,
    handicap_stones: handicapStones,
    result: gameInfo.result,
    tree: simplifyTree(result.tree),
    download_filename: options?.downloadFilename || 'game.sgf',
    default_move: defaultMove,
    max_moves: maxMoves,
  };
}

/**
 * 简化树结构，只保留 color, coord, children, properties(C/N)
 */
function simplifyTree(node: ISGFNode): ReplayNode {
  const simplified: ReplayNode = {
    color: node.color,
    coord: node.coord,
  };

  // 保留 C（注释）和 N（标签）属性
  if (node.properties) {
    const props: ReplayNode['properties'] = {};
    if (node.properties['C']) { const v = node.properties['C']; props['C'] = Array.isArray(v) ? v[0]! : v; }
    if (node.properties['N']) { const v = node.properties['N']; props['N'] = Array.isArray(v) ? v[0]! : v; }
    if (Object.keys(props).length > 0) {
      simplified.properties = props;
    }
  }

  // 递归处理子节点
  if (node.children && node.children.length > 0) {
    simplified.children = node.children.map(child => simplifyTree(child));
  }

  return simplified;
}

/**
 * 计算棋谱最大手数（只计算主分支，包括 Pass）
 */
function countMoves(node: ISGFNode): number {
  if (!node) return 0;
  // 只要有 color 就计数（包括 Pass）
  let count = node.color ? 1 : 0;
  if (node.children && node.children.length > 0) {
    count += countMoves(node.children[0]!);
  }
  return count;
}