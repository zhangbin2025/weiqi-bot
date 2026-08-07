/**
 * @fileoverview 手谈提供者接口
 */

import type { IGameProvider } from '../base/IProvider';

/**
 * 手谈提供者接口
 */
export interface IShoutanProvider extends IGameProvider {
  /**
   * 通过棋谱 ID 获取 SGF
   */
  fetchByKifuId(kifuId: string): Promise<import('./types').ShoutanApiResponse>;
}