/**
 * 打谱页面依赖组装
 * @description 组装 ReplayApp 所需的依赖
 */

import { ReplayApp } from '../../../../application/replay';
import { ExportService } from '../../../../services/export/ExportService';
import { WebAudioPlayer } from '../../../../infrastructure/audio/WebAudioPlayer';
import { WebFileExporter } from '../../../../infrastructure/utils/export/WebFileExporter';
import { GameService } from '../../../../services/game/GameService';
import { SessionService } from '../../../../services/session';
import type { WebShellContext } from '../Context';
import type { IGameService } from '../../../../services/game/IGameService';

/** 打谱依赖集合 */
export interface ReplayDeps {
  /** 打谱应用 */
  replayApp: ReplayApp;
}

/** 创建打谱依赖 */
export async function createReplayDeps(ctx: WebShellContext): Promise<ReplayDeps> {
  const fileExporter = new WebFileExporter();
  const exportService = new ExportService(fileExporter);
  const audioPlayer = new WebAudioPlayer();
  
  const gameService = new GameService(ctx.network, {
    historyStorage: ctx.gameHistoryStorage,
  });
  
  const cacheStorage = ctx.createCacheStorage();
  await cacheStorage.initialize();
  const sessionService = new SessionService(cacheStorage);
  
  const replayApp = new ReplayApp(exportService, audioPlayer, gameService, sessionService);
  
  return { replayApp };
}
