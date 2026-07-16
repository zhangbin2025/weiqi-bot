/**
 * @fileoverview 野狐围棋用户查询功能
 */

import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { FoxwqUser, FoxwqUserResponse } from './types';

/** 野狐 API 基础 URL */
const FOXWQ_USER_API = 'https://newframe.foxwq.com/cgi/QueryUserInfoPanel';

/**
 * 野狐围棋用户查询提供者
 */
export class FoxwqUserProvider {
  constructor(
    private readonly network: NetworkManager
  ) {}

  /**
   * 通过昵称查询用户信息
   */
  async queryUserByName(nickname: string): Promise<FoxwqUser> {
    const params = new URLSearchParams({
      srcuid: '0',
      username: nickname,
    });

    // 通过 NetworkManager.request()，让策略层选择 ProxyProvider
    const response = await this.network.request<FoxwqUserResponse>({
      url: `${FOXWQ_USER_API}?${params}`,
      method: 'GET',
    });

    if (response.data.result !== 0) {
      const errorMsg = response.data.resultstr || response.data.errmsg || '未知错误';
      throw new Error(`查询用户失败: ${errorMsg}`);
    }

    const uid = String(response.data.uid || '').trim();
    if (!uid) {
      throw new Error('未找到该昵称对应的UID');
    }

    return {
      uid,
      nickname: response.data.username || response.data.name || response.data.englishname || nickname,
      dan: response.data.dan || 0,
      totalWin: response.data.totalwin || 0,
      totalLost: response.data.totallost || 0,
      totalEqual: response.data.totalequal || 0,
    };
  }
}