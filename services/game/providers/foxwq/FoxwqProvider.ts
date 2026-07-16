/**
 * @fileoverview FoxwqProvider 实现（组合模式）
 */

import type { IFoxwqProvider } from './IFoxwqProvider';
import type {
  FoxwqUser,
  FoxwqGame,
  PublicQipu,
  PublicQipuDetail,
} from './types';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import { FoxwqUserProvider } from './FoxwqUserProvider';
import { FoxwqChessProvider } from './FoxwqChessProvider';
import { FoxwqPublicProvider } from './FoxwqPublicProvider';

/**
 * 野狐围棋提供者
 *
 * 实现野狐围棋棋谱下载功能，包括用户查询、棋谱列表获取、SGF 下载等。
 * 使用组合模式拆分功能模块。
 */
export class FoxwqProvider implements IFoxwqProvider {
  private readonly userProvider: FoxwqUserProvider;
  private readonly chessProvider: FoxwqChessProvider;
  private readonly publicProvider: FoxwqPublicProvider;

  /**
   * 创建 FoxwqProvider 实例
   * @param network - 网络管理器
   */
  constructor(network: NetworkManager) {
    this.userProvider = new FoxwqUserProvider(network);
    this.chessProvider = new FoxwqChessProvider(network);
    this.publicProvider = new FoxwqPublicProvider(network);
  }

  async queryUserByName(nickname: string): Promise<FoxwqUser> {
    return this.userProvider.queryUserByName(nickname);
  }

  async fetchChessList(uid: string, lastcode?: string): Promise<FoxwqGame[]> {
    return this.chessProvider.fetchChessList(uid, lastcode);
  }

  async fetchSGF(chessid: string): Promise<string> {
    return this.chessProvider.fetchSGF(chessid);
  }

  async fetchPublicQipuList(date?: string): Promise<PublicQipu[]> {
    return this.publicProvider.fetchPublicQipuList(date);
  }

  async fetchPublicQipuSgf(url: string): Promise<PublicQipuDetail> {
    return this.publicProvider.fetchPublicQipuSgf(url);
  }
}