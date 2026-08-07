/**
 * 赛事查询依赖组装
 * @description 从 Event Shell 中提取的依赖创建逻辑
 */

import { EventService } from '../../../../services/event/EventService';
import { RankingCalculator } from '../../../../domain/ranking/RankingCalculator';
import { ReadMarkService } from '../../../../services/readmark/ReadMarkService';
import { EventQuerier } from '../../../../application/event';
import { HtmlEventFormatter } from '../../../../presentation/adapters/web/HtmlEventFormatter';
import { createEventCache, createReadMarkStorage } from '../storage';
import type { WebShellContext } from '../Context';

/** 赛事查询依赖集合 */
export interface EventDeps {
  /** 赛事查询器 */
  querier: EventQuerier;
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

  return { querier, formatter, readMarkService };
}
