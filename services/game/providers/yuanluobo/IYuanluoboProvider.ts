/**
 * @fileoverview 元萝卜提供者接口
 */

import type { IGameProvider } from '../base/IProvider';

/**
 * 元萝卜提供者接口
 */
export interface IYuanluoboProvider extends IGameProvider {
  /**
   * 通过会话 ID 获取 SGF
   */
  fetchBySessionId(sessionId: string): Promise<string>;
}