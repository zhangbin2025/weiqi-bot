/**
 * @fileoverview OGS 玩家查询提供者
 *
 * 提供按用户名精确搜索玩家、获取玩家最近已结束对局列表的能力。
 * 数据通过 OGS REST API 获取，匿名访问，无需认证。
 */

import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { OgsPlayerInfo, OgsPlayerGame } from './types';

/** OGS REST API 基础 URL */
const OGS_API_URL = 'https://online-go.com/api/v1';

/** OGS API 分页响应 */
interface OgsApiListResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/**
 * OGS 玩家查询提供者
 */
export class OgsPlayerProvider {
  constructor(
    private readonly network: NetworkManager
  ) {}

  /**
   * 按用户名精确搜索玩家
   *
   * @param username - OGS 用户名（精确匹配）
   * @returns 玩家信息，未找到返回 null
   */
  async searchPlayer(username: string): Promise<OgsPlayerInfo | null> {
    const url = `${OGS_API_URL}/players?username=${encodeURIComponent(username)}`;
    const response = await this.network.request<OgsApiListResponse<OgsPlayerInfo>>({
      url,
      method: 'GET',
    });

    const results = response.data?.results;
    if (!results || results.length === 0) {
      return null;
    }

    // 精确匹配：用户名完全一致
    const exact = results.find(p => p.username === username);
    return exact ?? null;
  }

  /**
   * 获取玩家最近已结束的 19×19 对局列表
   *
   * @param playerId - OGS 玩家 ID
   * @param count - 最大数量，默认 10
   * @returns 对局列表
   */
  async fetchPlayerGames(playerId: number, count: number = 10): Promise<OgsPlayerGame[]> {
    const pageSize = Math.min(count, 50);
    const url = `${OGS_API_URL}/players/${playerId}/games/?ended__isnull=false&ordering=-ended&width=19&height=19&page_size=${pageSize}`;

    const response = await this.network.request<OgsApiListResponse<OgsPlayerGame>>({
      url,
      method: 'GET',
    });

    return (response.data?.results ?? []).slice(0, count);
  }
}
