/**
 * 棋手查询依赖组装
 * @description 从 Player Shell 中提取的依赖创建逻辑
 */

import { PlayerService } from '../../../../services/player/PlayerService';
import { PlayerQuerier } from '../../../../application/player/PlayerQuerier';
import { HtmlPlayerFormatter } from '../../../../presentation/adapters/web/HtmlPlayerFormatter';
import { createPlayerCache } from '../storage';
import type { WebShellContext } from '../Context';

/** 棋手查询依赖集合 */
export interface PlayerDeps {
  /** 棋手查询器 */
  querier: PlayerQuerier;
  /** HTML 格式化器 */
  formatter: HtmlPlayerFormatter;
}

/** 创建棋手查询依赖 */
export async function createPlayerDeps(ctx: WebShellContext): Promise<PlayerDeps> {
  const cache = await createPlayerCache(ctx);
  const playerService = new PlayerService(ctx.network, cache, ctx.config);
  const querier = new PlayerQuerier(playerService, ctx.favoriteService);
  const formatter = new HtmlPlayerFormatter();
  return { querier, formatter };
}
