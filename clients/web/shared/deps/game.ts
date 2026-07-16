/**
 * 棋谱下载依赖组装
 * @description 组装 GameService 所需的归档存储、缓存等依赖
 */

import { GameService, GameHistoryStorage } from '../../../../services/game';
import { createGameArchiveCache, createGameHistoryIndex, createGameFileStorage } from '../storage';
import { AppSnifferProvider } from '../../../../infrastructure/network/adapters/app/AppSnifferProvider';
import { UnsupportedSnifferProvider } from '../../../../infrastructure/network/adapters/common/UnsupportedSnifferProvider';
import type { WebShellContext } from '../Context';
import type { ISnifferProvider } from '../../../../infrastructure/network/interfaces/ISnifferProvider';

/** 棋谱下载依赖集合 */
export interface GameDeps {
  /** Game 服务 */
  gameService: GameService;
}

/** 创建棋谱下载依赖 */
export async function createGameDeps(ctx: WebShellContext): Promise<GameDeps> {
  const [archiveCache, historyIndex, fileStorage] = await Promise.all([
    createGameArchiveCache(),
    createGameHistoryIndex(ctx),
    createGameFileStorage(),
  ]);

  const historyStorage = new GameHistoryStorage(historyIndex, fileStorage);
  await historyStorage.initialize();

  // 创建 SnifferProvider
  const snifferProvider = createSnifferProvider();

  const gameService = new GameService(ctx.network, {
    archiveCache,
    historyStorage,
    configProvider: ctx.config,
    snifferProvider,
  });

  return { gameService };
}

/**
 * 创建 SnifferProvider
 * 
 * 根据环境选择合适的实现：
 * - App 环境（WebView）：使用 AppSnifferProvider（通过 sniffer:// 协议）
 * - Web 环境（浏览器）：使用 UnsupportedSnifferProvider（不支持）
 */
function createSnifferProvider(): ISnifferProvider {
  // 检测是否在 App 环境中
  // 通过检查是否有 sniffer:// 协议支持来判断
  if (typeof window !== 'undefined') {
    // 创建一个临时的 AppSnifferProvider 来检测是否可用
    const appSniffer = new AppSnifferProvider();
    if (appSniffer.isAvailable()) {
      return appSniffer;
    }
  }
  
  // 默认返回不支持的 Provider
  return new UnsupportedSnifferProvider();
}
