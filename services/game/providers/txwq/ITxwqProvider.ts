/**
 * @fileoverview 腾讯围棋提供者接口
 */

import type { IGameProvider } from '../base/IProvider';

/**
 * 腾讯围棋提供者接口
 *
 * 扩展标准接口，提供腾讯围棋特定功能。
 */
export interface ITxwqProvider extends IGameProvider {
  /**
   * 通过 chessid 获取棋谱
   * @param chessId - 腾讯围棋对局 ID
   */
  fetchByChessId(chessId: string): Promise<void>;
}
