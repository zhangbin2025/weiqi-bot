/**
 * @fileoverview Game 服务实现
 */

import type { IGameService, GameServiceResult, FetchProgressCallback } from './IGameService';
import type { IGameProvider } from './providers/base/IProvider';
import type { NetworkManager } from '../../infrastructure/network/core/NetworkManager';
import type { ISnifferProvider } from '../../infrastructure/network/interfaces/ISnifferProvider';
import type { IUserContext } from '../../infrastructure/network/interfaces/IUserContext';
import type { IGameHistoryStorage } from './IGameHistoryStorage';
import type { IGameArchiveCache } from './IGameArchiveCache';
import type { IConfigProvider } from '../../infrastructure/config/interfaces/IConfigProvider';
import type { IGameConfig } from '../../infrastructure/config/schemas/GameConfigSchema';
import { GameProviderRegistry } from './GameProviderRegistry';
import { DefaultGameStrategy, type IGameStrategy } from './GameStrategy';
import { GameFetchHelper } from './GameFetchHelper';
import { GameFoxwqHelper } from './GameFoxwqHelper';

export interface IGameServiceOptions {
  strategy?: IGameStrategy;
  archiveCache?: IGameArchiveCache;
  historyStorage?: IGameHistoryStorage;
  snifferProvider?: ISnifferProvider;
  userContext?: IUserContext;
  configProvider?: IConfigProvider;
}

export class GameService implements IGameService {
  private registry: GameProviderRegistry;
  private fetchHelper: GameFetchHelper;
  private foxwqHelper: GameFoxwqHelper;
  private config: IGameConfig | null = null;
  private configProvider: IConfigProvider | null = null;
  private historyStorage?: IGameHistoryStorage | undefined;

  constructor(
    private readonly network: NetworkManager,
    options?: IGameServiceOptions
  ) {
    this.configProvider = options?.configProvider ?? null;
    this.historyStorage = options?.historyStorage ?? undefined;

    this.registry = new GameProviderRegistry(network, {
      snifferProvider: options?.snifferProvider,
      historyStorage: options?.historyStorage,
    });

    const strategy = options?.strategy ?? new DefaultGameStrategy({
      snifferProvider: options?.snifferProvider
    });

    this.fetchHelper = new GameFetchHelper({
      registry: this.registry,
      strategy,
      archiveCache: options?.archiveCache,
      historyStorage: options?.historyStorage,
      userContext: options?.userContext,
    });

    this.foxwqHelper = new GameFoxwqHelper({
      registry: this.registry,
      archiveCache: options?.archiveCache,
      historyStorage: options?.historyStorage,
    });
  }

  async fetch(url: string): Promise<GameServiceResult> {
    return this.fetchHelper.fetch(url);
  }

  async fetchMany(urls: string[]): Promise<GameServiceResult[]> {
    return this.fetchHelper.fetchMany(urls);
  }

  canHandle(url: string): boolean {
    return Array.from(this.registry.getProviders().values()).some(p => p.canHandle(url));
  }

  async listPlayerGames(player: string, count?: number): Promise<string[]> {
    return this.foxwqHelper.listPlayerGames(player, count);
  }

  async listPublicGames(date?: string, count?: number): Promise<string[]> {
    return this.foxwqHelper.listPublicGames(date, count);
  }

  async fetchByChessIds(
    chessids: string[],
    options?: { onProgress?: FetchProgressCallback }
  ): Promise<GameServiceResult[]> {
    return this.foxwqHelper.fetchByChessIds(chessids, options);
  }

  getSupportedProviders(): string[] {
    return this.registry.getSupportedProviders();
  }

  registerProvider(provider: IGameProvider): void {
    this.registry.register(provider);
  }

  unregisterProvider(name: string): void {
    this.registry.unregister(name);
  }

  /**
   * 按归档ID获取棋谱内容
   */
  async getByArchiveId(archiveId: string): Promise<string | null> {
    if (!this.historyStorage) return null;
    
    const index = await this.historyStorage.findById(archiveId);
    if (!index) return null;
    
    const content = await this.historyStorage.readContent(index.path);
    return typeof content === 'string' ? content : null;
  }

  /**
   * 获取配置（延迟加载）
   */
  private async getConfig(): Promise<IGameConfig> {
    if (!this.config) {
      if (this.configProvider) {
        this.config = await this.configProvider.getModuleConfig<IGameConfig>('game');
      } else {
        // 默认配置
        this.config = {
          proxyUrl: 'https://api.weiqi.lol',
          foxwqBaseUrl: 'https://newframe.foxwq.com/cgi',
          foxwqChessBaseUrl: 'https://h5.foxwq.com/yehuDiamond/chessbook_local',
          foxwqPublicQipuUrl: 'https://www.foxwq.com/qipu.html',
          ogsApiUrl: 'https://online-go.com/api/v1',
          weiqi101BaseUrl: 'https://www.101weiqi.com',
          enableWebSocket: true,
          timeout: 30000,
          txwqApiUrl: 'https://h5.txwq.qq.com',
          yikeBaseUrl: 'https://home.yikeweiqi.com',
          weiqi1919BaseUrl: 'https://m.19x19.com',
          izisBaseUrl: 'http://app.izis.cn',
          xinboduiyiBaseUrl: 'https://www.xinboduiyi.com',
          shoutanApiUrl: 'https://v.dzqzd.com/Kifu/Details',
          yichengApiUrl: 'http://client.eweiqi.com/gibo/gibo_load_data.php',
          yikeShaoerApiUrl: 'https://mo.yikeweiqi.com/yikemo/anon/ayalyse/init',
          yuanluoboApiUrl: 'https://jupiter.yuanluobo.com/r2/chess/wq/sdr/v3/record/detail',
          gameCacheTTL: 3600000,
          enableGameCache: true,
        };
      }
    }
    return this.config;
  }
}
