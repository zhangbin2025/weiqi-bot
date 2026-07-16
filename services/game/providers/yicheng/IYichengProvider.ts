/**
 * @fileoverview 弈城围棋提供者接口
 */

import type { IGameProvider } from '../base/IProvider';

/**
 * 弈城围棋提供者接口
 */
export interface IYichengProvider extends IGameProvider {
  /**
   * 通过游戏 ID 获取 SGF
   */
  fetchByGameId(gameId: string): Promise<string>;
}