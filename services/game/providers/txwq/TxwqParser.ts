/**
 * @fileoverview 腾讯围棋数据解析器
 * 
 * 腾讯围棋的数据格式：
 * - 从 jsonp.php 接口返回 JSON
 * - JSON 中包含 "chess" 字段，直接是 SGF 字符串
 * - 不需要复杂的坐标转换
 */

import type { GameMetadata } from '../base/types';
import { parseSGF } from '../../../../domain/sgf';

/**
 * 腾讯围棋 API 响应数据
 */
export interface TxwqApiResponse {
  result: number;
  resultstr?: string;
  uin?: number;
  chess?: string; // SGF 字符串
}

/**
 * 腾讯围棋数据解析器
 */
export class TxwqParser {
  /**
   * 从 API 响应中提取 SGF 数据
   * @param response API 响应
   * @returns SGF 字符串，如果不存在返回 null
   */
  static extractSgf(response: TxwqApiResponse): string | null {
    if (!response.chess) return null;
    return response.chess;
  }

  /**
   * 从 SGF 中构建元数据
   * @param sgf SGF 字符串
   * @param chessId 对局 ID
   * @returns 元数据
   */
  static buildMetadata(sgf: string, chessId: string): GameMetadata {
    const result = parseSGF(sgf);
    const info = result.gameInfo;
    // domain 默认 komi='375'（表示 3.75），txwq 原默认 6.5
    const komiNum = parseFloat(info.komi);
    const komi = (info.komi === '375' || isNaN(komiNum)) ? 6.5 : komiNum;
    return {
      source: 'txwq',
      gameId: chessId,
      blackName: info.black || '黑棋',
      whiteName: info.white || '白棋',
      blackRank: info.blackRank || '',
      whiteRank: info.whiteRank || '',
      width: info.boardSize,
      height: info.boardSize,
      komi,
      handicap: info.handicap,
      rules: info.rules || 'chinese',
      date: info.date || '',
      result: info.result || '',
      movesCount: result.moves.length,
    };
  }

  /**
   * 验证 SGF 格式是否有效
   * @param sgf SGF 字符串
   * @returns 是否有效
   */
  static isValidSgf(sgf: string): boolean {
    // 基本检查：SGF 必须以 (; 开头
    if (!sgf.startsWith('(;')) return false;
    
    // 必须包含 GM[1]（围棋）
    if (!sgf.includes('GM[1]')) return false;
    
    // 必须包含棋盘大小
    if (!sgf.includes('SZ[')) return false;
    
    return true;
  }

  /**
   * 清理 SGF（去除多余的空格和换行）
   * @param sgf SGF 字符串
   * @returns 清理后的 SGF
   */
  static cleanSgf(sgf: string): string {
    // 去除多余的空格，但保留必要的格式
    return sgf
      .replace(/\s+/g, ' ')
      .replace(/\s+\]/g, ']')
      .replace(/\[\s+/g, '[')
      .trim();
  }
}
