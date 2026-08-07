/**
 * @fileoverview 弈客围棋提供者接口
 */

import type { IGameProvider } from '../base/IProvider';

/**
 * 弈客围棋提供者接口
 */
export interface IYikeProvider extends IGameProvider {
  /**
   * 通过房间 ID 获取棋谱
   */
  fetchByRoomId(roomId: string): Promise<void>;
}
