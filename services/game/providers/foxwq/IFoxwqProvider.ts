/**
 * @fileoverview 野狐围棋提供者接口定义
 */

import type {
  FoxwqUser,
  FoxwqGame,
  PublicQipu,
  PublicQipuDetail,
} from './types';

/**
 * 野狐围棋提供者接口
 *
 * 提供野狐围棋棋谱下载功能，包括用户查询、棋谱列表获取、SGF 下载等。
 *
 * @ai-example
 * const provider: IFoxwqProvider = new FoxwqProvider(network, cache, config);
 * const user = await provider.queryUserByName('柯洁');
 * const games = await provider.fetchChessList(user.uid);
 */
export interface IFoxwqProvider {
  /**
   * 通过昵称查询用户信息
   * @param nickname - 野狐昵称
   * @returns 用户信息
   * @ai-example
   * const user = await provider.queryUserByName('柯洁');
   * console.log(user.uid, user.nickname);
   */
  queryUserByName(nickname: string): Promise<FoxwqUser>;

  /**
   * 获取用户棋谱列表
   * @param uid - 用户 UID
   * @param lastcode - 分页编码（可选，默认 "0"）
   * @returns 棋谱列表
   * @ai-example
   * const games = await provider.fetchChessList('123456');
   * console.log(games[0].chessid);
   */
  fetchChessList(uid: string, lastcode?: string): Promise<FoxwqGame[]>;

  /**
   * 下载单局 SGF
   * @param chessid - 棋谱 ID
   * @returns SGF 内容
   * @ai-example
   * const sgf = await provider.fetchSGF('abc123');
   */
  fetchSGF(chessid: string): Promise<string>;

  /**
   * 获取公开棋谱列表
   * @param date - 日期过滤（格式 'YYYY-MM-DD'，可选）
   * @returns 公开棋谱列表
   * @ai-example
   * const qipus = await provider.fetchPublicQipuList('2024-01-15');
   */
  fetchPublicQipuList(date?: string): Promise<PublicQipu[]>;

  /**
   * 下载公开棋谱 SGF
   * @param url - 棋谱详情页 URL
   * @returns 公开棋谱详情
   * @ai-example
   * const detail = await provider.fetchPublicQipuSgf('https://...');
   * console.log(detail.sgf);
   */
  fetchPublicQipuSgf(url: string): Promise<PublicQipuDetail>;
}
