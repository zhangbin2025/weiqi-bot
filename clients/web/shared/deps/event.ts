/**
 * 赛事查询依赖组装
 * @description 从 Event Shell 中提取的依赖创建逻辑
 */

import { EventService } from '../../../../services/event/EventService';
import { IpGeoService } from '../../../../services/event/IpGeoService';
import { RankingCalculator } from '../../../../domain/ranking/RankingCalculator';
import { ReadMarkService } from '../../../../services/readmark/ReadMarkService';
import { EventQuerier, IpGeoQuerier } from '../../../../application/event';
import { HtmlEventFormatter } from '../../../../presentation/adapters/web/HtmlEventFormatter';
import { createEventCache, createReadMarkStorage } from '../storage';
import type { WebShellContext } from '../Context';

/** 赛事查询依赖集合 */
export interface EventDeps {
  /** 赛事查询器 */
  querier: EventQuerier;
  /** IP 定位查询器（可选） */
  ipGeoQuerier?: IpGeoQuerier;
  /** HTML 格式化器 */
  formatter: HtmlEventFormatter;
  /** 已读标记服务 */
  readMarkService: ReadMarkService;
}

/** 创建赛事查询依赖 */
export async function createEventDeps(ctx: WebShellContext): Promise<EventDeps> {
  const eventCache = await createEventCache(ctx);
  const eventService = new EventService(ctx.network, eventCache as never, ctx.config);

  const rankingCalculator = new RankingCalculator();

  const readMarkStorage = await createReadMarkStorage(ctx);
  const readMarkService = new ReadMarkService(readMarkStorage as never);

  const querier = new EventQuerier(eventService, rankingCalculator, ctx.favoriteService);
  const formatter = new HtmlEventFormatter();

  // IP 定位服务（可选，失败不影响主流程）
  let ipGeoQuerier: IpGeoQuerier | undefined;
  try {
    const ipGeoService = new IpGeoService(ctx.network, ctx.logger);
    ipGeoQuerier = new IpGeoQuerier(ipGeoService);
  } catch (e) {
    console.warn?.('IpGeoService 初始化失败', { error: String(e) });
  }

  return { querier, ipGeoQuerier, formatter, readMarkService };
}
