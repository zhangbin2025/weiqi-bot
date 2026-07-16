/**
 * @fileoverview 弈客少儿提供者接口
 */

import type { IGameProvider } from '../base/IProvider';

/**
 * 弈客少儿提供者接口
 */
export interface IYikeShaoerProvider extends IGameProvider {
  /**
   * 通过游戏 ID 获取 SGF
   */
  fetchByGameId(gameId: string): Promise<string>;
}