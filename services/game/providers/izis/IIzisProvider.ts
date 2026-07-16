/**
 * @fileoverview izis围棋提供者接口
 */

import type { IGameProvider } from '../base/IProvider';

/**
 * izis围棋提供者接口
 */
export interface IIzisProvider extends IGameProvider {
  /**
   * 通过游戏 ID 获取数据
   */
  fetchByGameId(gameId: string): Promise<void>;
}
