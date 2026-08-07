/**
 * @fileoverview Game 服务模块导出
 */

// 服务
export { GameService } from './GameService';
export { GameProviderRegistry } from './GameProviderRegistry';
export type { IGameService, GameServiceResult } from './IGameService';
export type { FetchResult, GameMetadata, PerformanceTiming } from './providers/base/types';

// 缓存服务
export { GameArchiveCache } from './GameArchiveCache';
export type { IGameArchiveCache } from './IGameArchiveCache';

// 提供者
export { BaseProvider } from './providers/base/BaseProvider';
export type { IGameProvider } from './providers/base/IProvider';

// 历史归档
export { GameHistoryStorage } from './GameHistoryStorage';
export type { IGameHistoryStorage, GameHistoryIndex, ArchiveParams, ArchiveResult, HistoryQuery } from './IGameHistoryStorage';

// 内部辅助类（用于测试）
export { GameFetchHelper } from './GameFetchHelper';
export type { GameFetchHelperOptions } from './GameFetchHelper';
export { GameFoxwqHelper } from './GameFoxwqHelper';
export type { GameFoxwqHelperOptions } from './GameFoxwqHelper';

// 平台提供者
export { OgsProvider } from './providers/ogs';
export type { IOgsProvider } from './providers/ogs';

export { Weiqi101Provider } from './providers/weiqi101';
export type { IWeiqi101Provider } from './providers/weiqi101';

export { FoxwqProvider } from './providers/foxwq';
export type { IFoxwqProvider } from './providers/foxwq';

// 归档提供者
export { ArchiveProvider } from './providers/archive';