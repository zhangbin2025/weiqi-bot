/**
 * 分享服务实现
 * @module services/share/ShareService
 */

import { GameEncoder, type EncodedMove, type DecodedGame } from '../../domain/share/index.js';
import type { IShareService } from './IShareService.js';

/**
 * 分享服务
 *
 * 提供棋谱分享的核心功能：
 * - 生成可分享的URL链接
 * - 解码URL中的棋谱数据
 * - 转换为SGF格式
 *
 * @ai-example
 * const service = new ShareService('https://example.com/share/');
 * const url = service.generateShareUrl(moves);
 */
export class ShareService implements IShareService {
  readonly baseUrl: string;

  /**
   * 创建分享服务实例
   * @param baseUrl - 分享页面基础URL，默认为官方分享页面
   */
  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? 'https://weiqi-dev.github.io/weiqi-assets/share/';
  }

  /**
   * 生成分享链接
   */
  generateShareUrl(moves: EncodedMove[], boardSize?: number, handicap?: number): string | null {
    const encoded = GameEncoder.encode(moves, boardSize, handicap);
    if (!encoded) return null;
    return this.baseUrl + '?d=' + encoded;
  }

  /**
   * 解码分享链接中的棋谱
   */
  decodeShareUrl(url: string): DecodedGame | null {
    try {
      const urlObj = new URL(url);
      const encoded = urlObj.searchParams.get('d');
      if (!encoded) return null;
      return this.decodeParam(encoded);
    } catch {
      return null;
    }
  }

  /**
   * 解码分享参数
   */
  decodeParam(encoded: string): DecodedGame | null {
    return GameEncoder.decode(encoded);
  }

  /**
   * 棋谱转 SGF 格式
   */
  toSGF(game: DecodedGame): string {
    return GameEncoder.toSGF(game);
  }
}
