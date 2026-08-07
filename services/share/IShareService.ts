/**
 * 分享服务接口
 * @module services/share/IShareService
 */

import type { EncodedMove, DecodedGame } from '../../domain/share/index.js';

/**
 * 分享服务接口
 *
 * 提供棋谱分享链接生成、解码和格式转换功能
 *
 * @ai-example
 * const service: IShareService = new ShareService();
 * const url = service.generateShareUrl(moves, 19, 0);
 * const game = service.decodeShareUrl(url);
 */
export interface IShareService {
  /** 分享 URL 基础路径 */
  readonly baseUrl: string;

  /**
   * 生成分享链接
   * @param moves - 手数列表
   * @param boardSize - 棋盘大小，默认19
   * @param handicap - 让子数，默认0
   * @returns 分享链接，无手数返回null
   */
  generateShareUrl(moves: EncodedMove[], boardSize?: number, handicap?: number): string | null;

  /**
   * 解码分享链接中的棋谱
   * @param url - 分享链接
   * @returns 棋谱数据，失败返回null
   */
  decodeShareUrl(url: string): DecodedGame | null;

  /**
   * 解码分享参数
   * @param encoded - 编码后的参数
   * @returns 棋谱数据，失败返回null
   */
  decodeParam(encoded: string): DecodedGame | null;

  /**
   * 棋谱转 SGF 格式
   * @param game - 解码后的棋谱数据
   * @returns SGF格式字符串
   */
  toSGF(game: DecodedGame): string;
}
