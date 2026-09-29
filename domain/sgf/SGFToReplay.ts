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
  initial_player?: 'black' | 'white' ;
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

  // 死活题检测：死活题默认从第 0 手开始（空盘），不跳到最后一手
  const tsumego = isTsumegoSGF(result.tree);

  // 处理 defaultMove
  let defaultMove: number;
  if (tsumego && (options?.defaultMove === undefined || options?.defaultMove === -1)) {
    // 死活题且未指定手数：从第 0 手开始
    defaultMove = 0;
  } else if (options?.defaultMove === -1 || options?.defaultMove === undefined) {
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
    ...(gameInfo.initialPlayer ? { initial_player: gameInfo.initialPlayer } : {}),
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
 * 计算棋谱最大手数（只计算主分支）
 * 遇到双方连续停一手（Pass）时停止计数，后续着法忽略
 */
function countMoves(node: ISGFNode): number {
  if (!node) return 0;
  let count = 0;
  let consecutivePasses = 0;
  let current: ISGFNode | undefined = node;

  while (current && current.children && current.children.length > 0) {
    current = current.children[0]!;
    if (!current.color) continue;

    if (current.coord) {
      consecutivePasses = 0;
    } else {
      // Pass（无坐标）
      consecutivePasses++;
      if (consecutivePasses >= 2) { count--; break; } // 双方停一手，回退前一个Pass计数后结束
    }
    count++;
  }

  return count;
}

/**
 * 检测是否为死活题（tsumego）SGF
 *
 * 识别两种模式：
 * 1. 传统死活题：有 AB/AW 摆子 + 有子分支 + 分支含正解/变化/失败注释
 * 2. OGS 风格死活题：无摆子，但根节点有多个子分支，分支注释含正解/变化/失败关键词
 *    （此模式下主分支只是第一个答案分支，不应用来计算 max_moves）
 *
 * @returns true 表示这是死活题，max_moves 应为 0
 */
function isTsumegoSGF(tree: ISGFNode): boolean {
  if (!tree.children || tree.children.length === 0) return false;

  // 检查子分支是否含死活题注释关键词
  let hasTsumegoComment = false;
  for (const child of tree.children) {
    const comment = (child.properties?.['C'] as string | undefined) || '';
    if (comment.includes('正解') || comment.includes('变化') || comment.includes('失败')) {
      hasTsumegoComment = true;
      break;
    }
  }

  if (!hasTsumegoComment) return false;

  // 模式1：有摆子（传统死活题）
  const hasSetup = (tree.properties?.['AB'] !== undefined) || (tree.properties?.['AW'] !== undefined);
  if (hasSetup) return true;

  // 模式2：无摆子但有多个答案分支（OGS 风格）
  // 根节点本身无着法（color 为 null），子分支是答案
  if (tree.color === null && tree.children.length >= 1) {
    return true;
  }

  return false;
}