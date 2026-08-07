/**
 * Replay 数据生成辅助模块
 * 将 SGF 转换为 replay 格式数据
 * @module presentation/core/helpers/ReplayHelper
 */
import type { ReplayData, ReplayNode } from '../../../domain/sgf';
/** SGF 解析结果 */
export interface SGFParseResult {
  tree: SGFNode;
  errors: string[];
}
/** SGF 树节点 */
export interface SGFNode {
  properties: Record<string, string[]>;
  children: SGFNode[];
  parent: SGFNode | null;
}
/** 游戏信息（可选） */
export interface GameInfo {
  game_name?: string;
  black?: string;
  white?: string;
  black_rank?: string;
  white_rank?: string;
  board_size?: number;
  handicap?: number;
  handicap_stones?: Array<{ x: number; y: number; color: 'B' | 'W' }>;
  result?: string;
  download_filename?: string;
}
/**
 * Replay 数据生成器
 * 封装 SGF 解析和 replay 数据构造逻辑
 */
export class ReplayHelper {
  /**
   * 从 SGF 内容生成 replay 数据
   * 
   * @param sgfContent - SGF 内容
   * @param gameInfo - 游戏信息（可选）
   * @param defaultMove - 默认跳转手数（-1 表示最后一手）
   * @returns Replay 数据
   */
  static generateReplayData(
    sgfContent: string,
    gameInfo: GameInfo = {},
    defaultMove: number = -1
  ): ReplayData {
    // 解析 SGF
    const parsed = this.parseSGF(sgfContent);
    if (!parsed || !parsed.tree) {
      throw new Error('SGF 解析失败');
    }
    // 转换树结构
    const cleanTree = this.convertTree(parsed.tree);
    // 计算最大手数
    const maxMoves = this.countMaxMoves(cleanTree);
    // 从 SGF 属性中提取信息
    const props = parsed.tree.properties || {};
    const getProp = (key: string, defaultVal: string = ''): string => {
      const val = props[key];
      if (Array.isArray(val) && val.length > 0) {
        return String(val[0]);
      }
      return val ? String(val) : defaultVal;
    };
    // 解析让子位置
    const handicapStones = this.parseHandicapStones(props['AB'] || []);
    // 构造 replay 数据格式
    const replayData: ReplayData = {
      game_name: gameInfo.game_name || `${gameInfo.black || getProp('PB', '黑棋')} vs ${gameInfo.white || getProp('PW', '白棋')}`,
      black: gameInfo.black || getProp('PB', '黑棋'),
      white: gameInfo.white || getProp('PW', '白棋'),
      black_rank: gameInfo.black_rank || getProp('BR', ''),
      white_rank: gameInfo.white_rank || getProp('WR', ''),
      board_size: parseInt(gameInfo.board_size?.toString() || getProp('SZ', '19')),
      handicap: parseInt(gameInfo.handicap?.toString() || getProp('HA', '0')),
      handicap_stones: gameInfo.handicap_stones || handicapStones,
      result: gameInfo.result || getProp('RE', ''),
      tree: cleanTree,
      download_filename: gameInfo.download_filename || 'game.sgf',
      default_move: defaultMove === -1 ? maxMoves : defaultMove,
      max_moves: maxMoves,
    };
    return replayData;
  }
  /**
   * 解析 SGF 内容
   * 
   * @param sgf - SGF 内容
   * @returns 解析结果
   */
  static parseSGF(sgf: string): SGFParseResult {
    const errors: string[] = [];
    let pos = 0;
    const skipWhitespace = (): void => {
      while (pos < sgf.length && sgf[pos] && /\s/.test(sgf[pos]!)) pos++;
    };
    const parseProperties = (): Record<string, string[]> => {
      const props: Record<string, string[]> = {};
      while (pos < sgf.length) {
        skipWhitespace();
        const char = sgf[pos];
        if (!char) break;
        // 检查是否是属性名
        if (!/^[A-Z]/.test(char)) break;
        // 读取属性名
        let propName = '';
        while (pos < sgf.length && sgf[pos] && /^[A-Z]/.test(sgf[pos]!)) {
          propName += sgf[pos]!;
          pos++;
        }
        skipWhitespace();
        // 读取属性值
        const values: string[] = [];
        while (pos < sgf.length && sgf[pos] === '[') {
          pos++; // skip [
          let value = '';
          while (pos < sgf.length && sgf[pos] && sgf[pos] !== ']') {
            if (sgf[pos] === '\\' && pos + 1 < sgf.length) {
              pos++;
              value += sgf[pos]!;
              pos++;
            } else {
              value += sgf[pos]!;
              pos++;
            }
          }
          if (pos < sgf.length) pos++; // skip ]
          values.push(value);
          skipWhitespace();
        }
        if (values.length > 0) {
          props[propName] = values;
        }
      }
      return props;
    };
    const parseNode = (parent: SGFNode | null): SGFNode | null => {
      skipWhitespace();
      if (pos >= sgf.length) return null;
      const node: SGFNode = {
        properties: {},
        children: [],
        parent,
      };
      // 解析属性
      node.properties = parseProperties();
      // 解析子节点（可以是序列或分支）
      while (pos < sgf.length) {
        skipWhitespace();
        const char = sgf[pos];
        if (!char) break;
        if (char === ')') break;
        if (char === '(') {
          // 新分支
          pos++; // skip (
          const child = parseNode(node);
          if (child) node.children.push(child);
          skipWhitespace();
          if (pos < sgf.length && sgf[pos] === ')') pos++;
        } else if (char === ';') {
          // 序列中的下一个节点
          pos++; // skip ;
          const child = parseNode(node);
          if (child) node.children.push(child);
          break; // 序列结束后返回
        } else if (char === '[') {
          // 更多属性值
          const moreProps = parseProperties();
          Object.assign(node.properties, moreProps);
        } else {
          break;
        }
      }
      return node;
    };
    skipWhitespace();
    // 期望以 (; 或 ( 开始
    if (pos < sgf.length && sgf[pos] === '(') {
      pos++;
      skipWhitespace();
      if (pos < sgf.length && sgf[pos] === ';') {
        pos++;
      }
    } else {
      errors.push('SGF 必须以 (; 开始');
    }
    const tree = parseNode(null);
    return { tree: tree || { properties: {}, children: [], parent: null }, errors };
  }
  /**
   * 转换 SGF 树为 Replay 树
   * 只保留 color, coord, children, properties(C/N)
   * 
   * @param node - SGF 树节点
   * @returns Replay 树节点
   */
  static convertTree(node: SGFNode): ReplayNode {
    const props = node.properties || {};
    // 检查是否有落子
    let color: 'B' | 'W' | null = null;
    let coord: string | null = null;
    if (props['B'] && props['B'].length > 0) {
      color = 'B';
      coord = props['B'][0] ?? null;
    } else if (props['W'] && props['W'].length > 0) {
      color = 'W';
      coord = props['W'][0] ?? null;
    }
    const replayNode: ReplayNode = {
      color,
      coord,
    };
    // 保留 C（注释）和 N（标签）属性
    const keepProps: Record<string, string> = {};
    if (props['C'] && props['C'].length > 0) keepProps['C'] = props['C'][0]!;
    if (props['N'] && props['N'].length > 0) keepProps['N'] = props['N'][0]!;
    if (Object.keys(keepProps).length > 0) {
      replayNode.properties = keepProps;
    }
    // 递归处理子节点
    if (node.children && node.children.length > 0) {
      replayNode.children = node.children
        .map(child => this.convertTree(child))
        .filter(child => child !== null);
    }
    return replayNode;
  }
  /**
   * 计算棋谱最大手数
   * 
   * @param node - 树节点
   * @returns 最大手数
   */
  static countMaxMoves(node: ReplayNode | null): number {
    if (!node) return 0;
    let count = node.color ? 1 : 0;
    if (node.children && node.children.length > 0) {
      count += this.countMaxMoves(node.children[0]!);
    }
    return count;
  }
  /**
   * 解析让子位置
   * 
   * @param abValues - AB 属性值数组
   * @returns 让子位置数组
   */
  static parseHandicapStones(abValues: string[]): Array<{ x: number; y: number; color: 'B' | 'W' }> {
    const stones: Array<{ x: number; y: number; color: 'B' | 'W' }> = [];
    for (const value of abValues) {
      if (value.length >= 2) {
        stones.push({
          x: (value.charCodeAt(0) ?? 97) - 97,
          y: (value.charCodeAt(1) ?? 97) - 97,
          color: 'B',  // AB[] 属性添加的都是黑子
        });
      }
    }
    return stones;
  }
  /**
   * 保存 replay 数据到 localStorage
   * 
   * @param data - Replay 数据
   * @returns localStorage key
   */
  static saveToLocalStorage(data: ReplayData): string {
    const key = `${ReplayHelper.STORAGE_PREFIX}${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem(key, JSON.stringify(data));
    // 清理过期数据（超过 1 小时）
    ReplayHelper.cleanExpiredData();
    return key;
  }
  /**
   * 清理过期的 localStorage 数据
   */
  static cleanExpiredData(): void {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 小时
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(ReplayHelper.STORAGE_PREFIX)) {
        const parts = key.split('_');
        if (parts.length >= 2) {
          const timestamp = parseInt(parts[1]!);
          if (!isNaN(timestamp) && (now - timestamp) > maxAge) {
            keysToRemove.push(key);
          }
        }
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  }
  private static readonly STORAGE_PREFIX = 'replay_';
}
