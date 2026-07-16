/**
 * 记谱页面依赖组装
 * @description 组装 RecorderApp 所需的依赖
 */

import { RecorderApp, RecorderHistoryManager } from '../../../../application/recorder';
import { RecorderService } from '../../../../services/recorder/RecorderService';
import { ExportService } from '../../../../services/export/ExportService';
import { WebFileExporter } from '../../../../infrastructure/utils/export/WebFileExporter';
import { LocalStorageAdapter } from '../../../../infrastructure/storage/adapters/web/LocalStorageAdapter';
import { WebAudioPlayer } from '../../../../infrastructure/audio/WebAudioPlayer';
import { createGameDeps } from './game';
import type { WebShellContext } from '../Context';

/** 记谱依赖集合 */
export interface RecorderDeps {
  /** 记谱应用 */
  recorderApp: RecorderApp;
}

/** 创建记谱依赖 */
export async function createRecorderDeps(ctx: WebShellContext): Promise<RecorderDeps> {
  // 创建文件导出器
  const fileExporter = new WebFileExporter();

  // 创建导出服务
  const exportService = new ExportService(fileExporter);

  // 创建草稿存储（使用 LocalStorage）
  const draftStorage = new LocalStorageAdapter('weiqi-bot-recorder-draft');
  await draftStorage.initialize();

  // 创建记谱服务（传入 storage）
  const recorderService = new RecorderService(draftStorage);

  // 创建 Game 服务（复用 fetcher 的依赖组装）
  const { gameService } = await createGameDeps(ctx);

  // 创建历史管理器
  const historyManager = new RecorderHistoryManager(
    gameService,
    ctx.favoriteService,
  );

  // 创建记谱应用
  const audioPlayer = new WebAudioPlayer();
  const recorderApp = new RecorderApp(
    recorderService,
    exportService,
    historyManager,
    audioPlayer,
  );

  return { recorderApp };
}