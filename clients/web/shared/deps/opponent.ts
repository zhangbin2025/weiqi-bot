/**
 * 对手分析依赖组装
 * @description 组装 OpponentAnalyzer 所需的 GameService、JosekiDiscoverService 等依赖
 */

import { GameService, GameHistoryStorage } from '../../../../services/game';
import { JosekiLoader } from '../../../../services/joseki/JosekiLoader';
import { JosekiDiscoverService } from '../../../../services/joseki/discover/JosekiDiscoverService';
import { ActivityLogService } from '../../../../services/activity/ActivityLogService';
import { OpponentAnalyzer } from '../../../../application/opponent';
import { createGameArchiveCache, createGameHistoryIndex, createGameFileStorage } from '../storage';
import type { WebShellContext } from '../Context';

/** 对手分析依赖集合 */
export interface OpponentDeps {
  /** 对手分析器 */
  analyzer: OpponentAnalyzer;
}

/** 创建对手分析依赖 */
export async function createOpponentDeps(ctx: WebShellContext): Promise<OpponentDeps> {
  // 1. 创建定式加载器
  const loader = new JosekiLoader(
    ctx.network,
    {
      async upload() {},
      async download() { throw new Error('Not cached'); },
      async delete() {},
      async exists() { return false; },
      async getMetadata() { throw new Error('Not implemented'); },
      async readChunk() { throw new Error('Not implemented'); },
      async listFiles() { return []; },
      async createDirectory() {},
      async deleteDirectory() {},
      async initialize() {},
    },
    ctx.config
  );

  // 2. 创建定式发现服务
  const josekiDiscoverService = new JosekiDiscoverService(loader);

  // 3. 创建棋谱服务（带归档存储）
  const [archiveCache, historyIndex, fileStorage] = await Promise.all([
    createGameArchiveCache(),
    createGameHistoryIndex(ctx),
    createGameFileStorage(),
  ]);

  const historyStorage = new GameHistoryStorage(historyIndex, fileStorage);
  await historyStorage.initialize();

  const gameService = new GameService(ctx.network, {
    archiveCache,
    historyStorage,
    configProvider: ctx.config,
  });

  // 4. 创建活动日志服务
  const activityStorage = await ctx.createCache(
    'weiqi-activity',
    'entries'
  );
  const activityLogService = new ActivityLogService(activityStorage);

  // 5. 创建对手分析器
  const analyzer = new OpponentAnalyzer(
    gameService,
    josekiDiscoverService,
    activityLogService,
    ctx.favoriteService
  );

  return { analyzer };
}
