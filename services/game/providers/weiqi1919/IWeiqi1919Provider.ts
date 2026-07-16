/**
 * @fileoverview 1919围棋提供者接口
 */

import type { IGameProvider } from '../base/IProvider';

/**
 * 1919围棋提供者接口
 */
export interface IWeiqi1919Provider extends IGameProvider {
  /**
   * 通过棋谱 ID 获取数据
   */
  fetchBySgfId(sgfId: string): Promise<void>;
}
