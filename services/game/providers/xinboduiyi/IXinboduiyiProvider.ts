/**
 * @fileoverview 新博对弈提供者接口
 */

import type { IGameProvider } from '../base/IProvider';

/**
 * 新博对弈提供者接口
 */
export interface IXinboduiyiProvider extends IGameProvider {
  /**
   * 通过对局 ID 获取数据
   */
  fetchByGameId(gameId: string): Promise<void>;
}