/**
 * @fileoverview PlayerService 接口定义
 */

import type {
  PlayerQueryResult,
  ShoutanResult,
  YichafenResult,
} from './types';

/**
 * 棋手查询服务接口
 *
 * 提供棋手等级分和业余段位查询功能，支持多数据源并行查询。
 *
 * @ai-example
 * const service: IPlayerService = new PlayerService(network, cache, config);
 * const result = await service.query('柯洁');
 * console.log(result.shoutan.players[0].rating);
 */
export interface IPlayerService {
  /**
   * 查询棋手（并行查询手谈+易查分）
   * @param name - 棋手姓名
   * @returns 综合查询结果
   * @ai-example
   * const result = await service.query('柯洁');
   * if (result.shoutan.found) {
   *   console.log('手谈等级分:', result.shoutan.players[0].rating);
   * }
   */
  query(name: string): Promise<PlayerQueryResult>;

  /**
   * 单独查询手谈等级分
   * @param name - 棋手姓名
   * @returns 手谈等级分结果
   * @ai-example
   * const result = await service.queryShoutan('柯洁');
   */
  queryShoutan(name: string): Promise<ShoutanResult>;

  /**
   * 单独查询易查分业余段位
   * @param name - 棋手姓名
   * @returns 易查分结果
   * @ai-example
   * const result = await service.queryYichafen('柯洁');
   */
  queryYichafen(name: string): Promise<YichafenResult>;

  /**
   * 从缓存获取
   * @param name - 棋手姓名
   * @returns 缓存结果，不存在返回 null
   * @ai-example
   * const cached = await service.getFromCache('柯洁');
   */
  getFromCache(name: string): Promise<PlayerQueryResult | null>;
}
