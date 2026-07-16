/**
 * Web Shell 统一存储工厂
 * @description 提供 IndexedDB 缓存/存储的统一创建接口，数据库名统一使用 weiqi-bot- 前缀
 */

import type { WebShellContext } from './Context';
import type { IDocumentStorage } from '../../../infrastructure/storage/interfaces/IDocumentStorage';
import type { PlayerQueryResult } from '../../../services/player/types';
import type { GameHistoryIndex } from '../../../services/game/IGameHistoryStorage';
import type { IGameArchiveCache } from '../../../services/game/IGameArchiveCache';
import type { IFileStorage } from '../../../infrastructure/storage/interfaces/IFileStorage';
import { GameArchiveCache } from '../../../services/game/GameArchiveCache';
import { IndexedDBFileAdapter } from '../../../infrastructure/storage/adapters/web/IndexedDBFileAdapter';
import { MemoryAdapter } from '../../../infrastructure/storage/adapters/common/MemoryAdapter';

/** 棋手查询缓存条目类型 */
type PlayerCacheEntry = { id: string; blob: PlayerQueryResult; timestamp: number; size: number };

/** 赛事查询缓存条目类型 */
type EventCacheEntry = { id: string; blob: unknown; timestamp: number; size: number };

/** 已读标记条目类型 */
type ReadMarkEntry = { id: string; blob: unknown; timestamp: number; size: number };

/** 创建棋手查询缓存 */
export async function createPlayerCache(ctx: WebShellContext): Promise<IDocumentStorage<PlayerCacheEntry>> {
  return ctx.createCache<PlayerCacheEntry>('weiqi-bot-player', 'results');
}

/** 创建赛事查询缓存 */
export async function createEventCache(ctx: WebShellContext): Promise<IDocumentStorage<EventCacheEntry>> {
  return ctx.createCache<EventCacheEntry>('weiqi-bot-event', 'results');
}

/** 创建已读标记存储 */
export async function createReadMarkStorage(ctx: WebShellContext): Promise<IDocumentStorage<ReadMarkEntry>> {
  return ctx.createCache<ReadMarkEntry>('weiqi-bot-readmark', 'marks');
}

/** 创建棋谱归档缓存（URL → archiveId 映射）*/
export async function createGameArchiveCache(): Promise<IGameArchiveCache> {
  const adapter = new MemoryAdapter({ name: 'game-archive-cache' });
  await adapter.initialize();
  return new GameArchiveCache(adapter, { ttl: 3600000 });
}

/** 创建棋谱历史索引存储 */
export async function createGameHistoryIndex(ctx: WebShellContext): Promise<IDocumentStorage<GameHistoryIndex>> {
  return ctx.createCache<GameHistoryIndex>('weiqi-bot-game-history', 'index');
}

/** 创建棋谱文件存储 */
export async function createGameFileStorage(): Promise<IFileStorage> {
  const adapter = new IndexedDBFileAdapter('weiqi-bot-game-files');
  await adapter.initialize();
  return adapter;
}
