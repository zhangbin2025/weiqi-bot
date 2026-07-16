/**
 * @fileoverview PlayerService 实现
 */

import type { IPlayerService } from './IPlayerService';
import { parseShoutanHtml } from './ShoutanParser';
import { YichafenClient } from './YichafenClient';
import type { PlayerQueryResult, ShoutanResult, YichafenResult } from './types';
import type { NetworkManager } from '../../infrastructure/network/core/NetworkManager';
import type { ICacheStorage } from '../../infrastructure/storage/interfaces/ICacheStorage';
import type { IDocumentStorage } from '../../infrastructure/storage/interfaces/IDocumentStorage';
import type { IConfigProvider } from '../../infrastructure/config/interfaces/IConfigProvider';
import type { IPlayerConfig } from '../../infrastructure/config/schemas/PlayerConfigSchema';
import { ResourceCache } from '../../infrastructure/utils/cache';

/** 缓存键前缀 */
const CACHE_PREFIX = 'player:';

/**
 * 棋手查询服务
 */
export class PlayerService implements IPlayerService {
  private config: IPlayerConfig | null = null;
  private readonly playerCache: ResourceCache<PlayerQueryResult>;
  private readonly yichafenClient: YichafenClient;

  constructor(
    private readonly network: NetworkManager,
    private readonly cacheStorage: ICacheStorage | IDocumentStorage<{ id: string; blob: PlayerQueryResult; timestamp: number; size: number }>,
    private readonly configProvider: IConfigProvider
  ) {
    this.playerCache = new ResourceCache<PlayerQueryResult>(cacheStorage, {
      keyPrefix: CACHE_PREFIX,
      defaultTTL: 3600000,
    });
    this.yichafenClient = new YichafenClient();
  }

  async query(name: string): Promise<PlayerQueryResult> {
    const config = await this.getConfig();

    return this.playerCache.getOrDownload(
      name,
      async () => {
        const [shoutan, yichafen] = await Promise.allSettled([
          this.queryShoutan(name),
          this.queryYichafen(name),
        ]);

        const getError = (p: PromiseSettledResult<unknown>): string => {
          if (p.status === 'rejected') {
            const e = p.reason;
            return e instanceof Error ? e.message : String(e);
          }
          return '查询失败';
        };

        const result: PlayerQueryResult = {
          name,
          shoutan: shoutan.status === 'fulfilled' ? shoutan.value : {
            found: false, count: 0, players: [], error: getError(shoutan),
          },
          yichafen: yichafen.status === 'fulfilled' ? yichafen.value : {
            found: false, error: getError(yichafen),
          },
          cachedAt: new Date().toISOString(),
        };

        return result;
      },
      config.playerCacheTTL
    );
  }

  async queryShoutan(name: string): Promise<ShoutanResult> {
    const config = await this.getConfig();
    const xml = `<Redi Ns="Sp" Jk="选手查询" 姓名="${name}"/>`;
    const encoded = btoa(unescape(encodeURIComponent(xml)));
    const url = `${config.shoutanBaseUrl}?r=${encoded}`;

    try {
      const response = await this.network.request<string>({
        url,
        method: 'GET',
        timeout: config.timeout,
        responseType: 'text',
      });

      const players = parseShoutanHtml(response.data, name);
      return { found: players.length > 0, count: players.length, players };
    } catch (error) {
      return { found: false, count: 0, players: [], error: String(error) };
    }
  }

  async queryYichafen(name: string): Promise<YichafenResult> {
    const config = await this.getConfig();
    return this.yichafenClient.query(
      name,
      { timeout: config.timeout },
      this.network
    );
  }

  async getFromCache(name: string): Promise<PlayerQueryResult | null> {
    // ICacheStorage: 直接调用 get（key 需要带前缀）
    if ('get' in this.cacheStorage) {
      const key = `${CACHE_PREFIX}${name}`;
      return (this.cacheStorage as ICacheStorage).get<PlayerQueryResult>(key);
    }
    // IDocumentStorage: 调用 findById（key 不带前缀，ResourceCache 会直接使用 name）
    const doc = await (this.cacheStorage as IDocumentStorage<{ id: string; blob: PlayerQueryResult; timestamp: number; size: number }>).findById(name);
    return doc?.blob ?? null;
  }

  private async getConfig(): Promise<IPlayerConfig> {
    if (!this.config) {
      this.config = await this.configProvider.getModuleConfig<IPlayerConfig>('player');
    }
    return this.config;
  }
}
