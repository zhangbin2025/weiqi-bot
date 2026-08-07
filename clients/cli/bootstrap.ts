/**
 * CLI 环境引导 + 应用层编排器组装
 * @module clients/cli/bootstrap
 * @description 初始化基础设施（NetworkManager、ConfigProvider、Cache），
 *              并组装应用层编排器（PlayerQuerier、EventQuerier、FetcherApp、
 *              JosekiDiscoverApp、OpponentAnalyzer、DecisionApp）。
 *              命令文件只与编排器交互，不直接接触服务层。
 */

import * as os from 'os';
import * as path from 'path';
import * as dns from 'dns';
import * as fs from 'fs';

import { NetworkManager } from '../../infrastructure/network/core/NetworkManager';
import { DEFAULT_REMOTE_BASE } from '../../infrastructure/network/core/ServerConfig';
import { UserType } from '../../infrastructure/network/interfaces/UserType';
import { DirectProvider } from '../../infrastructure/network/adapters/cli/DirectProvider';
import { ProxyProvider } from '../../infrastructure/network/adapters/web/ProxyProvider';
import { PlaywrightSnifferProvider } from '../../infrastructure/network/adapters/cli/PlaywrightSnifferProvider';
import { JsonFileAdapter } from '../../infrastructure/storage/adapters/cli/JsonFileAdapter';
import { NodeFileAdapter } from '../../infrastructure/storage/adapters/cli/NodeFileAdapter';
import { MemoryAdapter } from '../../infrastructure/storage/adapters/common/MemoryAdapter';
import type { IConfigProvider } from '../../infrastructure/config/interfaces/IConfigProvider';
import type { ConfigKey, ConfigNamespace, ConfigChangeListener } from '../../infrastructure/config/interfaces/types';

import { PlayerQuerier } from '../../application/player/PlayerQuerier';
import { EventQuerier } from '../../application/event/EventQuerier';
import { FetcherApp } from '../../application/fetcher/FetcherApp';
import { JosekiDiscoverApp } from '../../application/joseki/JosekiDiscoverApp';
import { OpponentAnalyzer } from '../../application/opponent/OpponentAnalyzer';
import { DecisionApp } from '../../application/decision/DecisionApp';

import { PlayerService } from '../../services/player/PlayerService';
import { EventService } from '../../services/event/EventService';
import { GameService, GameHistoryStorage, GameArchiveCache } from '../../services/game';
import { DecisionService } from '../../services/decision/DecisionService';
import { JosekiDiscoverService } from '../../services/joseki/discover/JosekiDiscoverService';
import { JosekiLoader } from '../../services/joseki/JosekiLoader';
import { RankingCalculator } from '../../domain/ranking/RankingCalculator';
import { FavoriteService } from '../../services/favorite/FavoriteService';
import { ExportService } from '../../services/export/ExportService';
import { NetworkLoggerPlugin } from '../../infrastructure/network/plugins/NetworkLogger';
import type { GameHistoryIndex } from '../../services/game/IGameHistoryStorage';

/** CLI 运行时上下文 */
export interface CliContext {
  playerQuerier: PlayerQuerier;
  eventQuerier: EventQuerier;
  fetcherApp: FetcherApp;
  josekiDiscoverApp: JosekiDiscoverApp;
  opponentAnalyzer: OpponentAnalyzer;
  decisionApp: DecisionApp;
  decisionService: DecisionService;
  gameService: GameService;
  dataDir: string;
  loggerPlugin?: NetworkLoggerPlugin;
}

const DEFAULT_PROXY_URL = 'https://api.weiqi.lol';

const DEFAULT_PLAYER_CONFIG = {
  proxyUrl: '',
  shoutanBaseUrl: 'https://v.dzqzd.com/SpBody.aspx',
  yichafenBaseUrl: '',
  timeout: 30000,
  playerCacheTTL: 3600000,
  enablePlayerCache: true,
};

const DEFAULT_EVENT_CONFIG = {
  proxyUrl: '',
  eventsBaseUrl: 'https://data-center.yunbisai.com/api/lswl-events',
  groupsBaseUrl: 'https://open.yunbisai.com/api/event/feel/list',
  againstPlanBaseUrl: 'https://api.yunbisai.com/request/Group/Againstplan',
  timeout: 30000,
  eventCacheTTL: 1800000,
  enableEventCache: true,
};

const DEFAULT_GAME_CONFIG = {
  proxyUrl: '',
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

const DEFAULT_JOSEKI_CONFIG = {
  dataPath: './data/joseki',
  dataUrl: DEFAULT_REMOTE_BASE + '/shared/assets/data/joseki',
  trieMetaFile: 'trie-meta.json',
  enableDynamicLoad: false,
  maxQuizQuestions: 100,
  maxFavorites: 50,
  cacheTTL: 86400000,
};

const DEFAULT_MODULE_CONFIGS: Record<string, Record<string, unknown>> = {
  player: DEFAULT_PLAYER_CONFIG,
  event: DEFAULT_EVENT_CONFIG,
  game: DEFAULT_GAME_CONFIG,
  joseki: DEFAULT_JOSEKI_CONFIG,
};

class CliConfigProvider implements IConfigProvider {
  private readonly moduleConfigs: Record<string, Record<string, unknown>>;
  constructor(moduleConfigs?: Record<string, Record<string, unknown>>) {
    this.moduleConfigs = moduleConfigs ?? {};
  }
  async get<T>(_key: ConfigKey): Promise<T | undefined> { return undefined; }
  async set<T>(_key: ConfigKey, _value: T): Promise<void> {}
  async getModuleConfig<T>(module: ConfigNamespace): Promise<T> {
    return (this.moduleConfigs[module] ?? {}) as T;
  }
  async setModuleConfig<T>(_module: ConfigNamespace, _config: Partial<T>): Promise<void> {}
  onChange<T>(_key: ConfigKey, _callback: ConfigChangeListener<T>): () => void { return () => {}; }
  async reset(_key?: ConfigKey): Promise<void> {}
  async has(_key: ConfigKey): Promise<boolean> { return false; }
  async delete(_key: ConfigKey): Promise<void> {}
  registerSchema(_namespace: ConfigNamespace, _schema: unknown): void {}
}

export async function createCliContext(
  debug?: boolean,
  proxyUrl?: string,
  moduleConfigs?: Record<string, Record<string, unknown>>,
): Promise<CliContext> {
  // DNS override: bot.weiqi.lol 国内 DNS 被污染，手动解析
  if (typeof dns === 'undefined') {
    const dns = await import('dns');
    dns.setDefaultResultOrder('ipv4first');
  }

  const resolvedProxyUrl = proxyUrl ?? DEFAULT_PROXY_URL;
  const resolvedModuleConfigs = moduleConfigs ?? DEFAULT_MODULE_CONFIGS;

  // ── 1. 基础设施 ──
  const network = new NetworkManager({ defaultTimeout: 30000, retryCount: 2 });
  network.setUserContext({
    getUserType: async () => UserType.GUEST,
    hasPaidToken: async () => false,
    getAuthToken: async () => null,
    hasPermission: async () => false,
  });
  network.registerProvider(new DirectProvider());
  network.registerProvider(new ProxyProvider({ proxyUrl: resolvedProxyUrl }));

  let loggerPlugin: NetworkLoggerPlugin | undefined;
  if (debug) {
    loggerPlugin = new NetworkLoggerPlugin({
      enabled: true,
      logHeaders: true,
      logRequestBody: true,
      logResponseBody: false,
      customHandler: (entry) => {
        const mark = entry.success ? '✓' : '✗';
        const dur = entry.response?.duration ?? 0;
        const provider = entry.provider.replace(/^Logger\[/, '').replace(/\]$/, '');
        const errStr = entry.error ? ` error: ${entry.error.message}` : '';
        process.stderr.write(`[debug] ${mark} ${entry.request.method} ${entry.request.url} ${dur}ms ${provider}${errStr}\n`);
      },
    });
    network.loadPlugin(loggerPlugin);
  }

  await network.initialize();

  // ── 数据目录 ──
  const WEIQI_DIR = path.join(os.homedir(), '.weiqi-bot');
  const PLAYER_DIR = path.join(WEIQI_DIR, 'player');
  const GAME_DIR = path.join(WEIQI_DIR, 'game');
  const JOSEKI_DIR = path.join(WEIQI_DIR, 'joseki');
  const OPPONENT_DIR = path.join(WEIQI_DIR, 'opponent');
  const DECISION_DIR = path.join(WEIQI_DIR, 'decision');
  for (const dir of [PLAYER_DIR, GAME_DIR, JOSEKI_DIR, OPPONENT_DIR, DECISION_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // ── 存储适配器 ──
  const cache = new JsonFileAdapter(path.join(PLAYER_DIR, 'cache.json'));
  await cache.initialize();

  const favoritesStorage = new JsonFileAdapter(path.join(WEIQI_DIR, 'favorites.json'));
  await favoritesStorage.initialize();

  const config = new CliConfigProvider(resolvedModuleConfigs);

  // ── Sniffer ──
  const snifferProvider = new PlaywrightSnifferProvider();

  // ── Game 服务 ──
  const gameHistoryIndex = new JsonFileAdapter<GameHistoryIndex>(path.join(GAME_DIR, 'history-index.json'));
  await gameHistoryIndex.initialize();

  const gameFileStorage = new NodeFileAdapter(path.join(GAME_DIR, 'files'));
  await gameFileStorage.initialize();

  const gameHistoryStorage = new GameHistoryStorage(gameHistoryIndex, gameFileStorage, 'games');
  await gameHistoryStorage.initialize();

  const archiveCacheAdapter = new MemoryAdapter({ name: 'game-archive-cache' });
  await archiveCacheAdapter.initialize();
  const archiveCache = new GameArchiveCache(archiveCacheAdapter, { ttl: 3600000 });

  const gameService = new GameService(network, {
    archiveCache,
    historyStorage: gameHistoryStorage,
    configProvider: config,
    snifferProvider,
  });

  // ── 2. 应用层编排器组装 ──
  const favoriteService = new FavoriteService(favoritesStorage);
  const playerQuerier = new PlayerQuerier(new PlayerService(network, cache, config), favoriteService);
  const eventQuerier = new EventQuerier(new EventService(network, cache, config), new RankingCalculator(), favoriteService);

  const exportService = new ExportService({ exportText: async () => ({ success: true }), exportJSON: async () => ({ success: true }) } as any);
  const fetcherApp = new FetcherApp(gameService, exportService, favoriteService);

  const josekiLoader = new JosekiLoader(network, gameFileStorage as any, config);
  const josekiDiscoverService = new JosekiDiscoverService(josekiLoader);
  const josekiDiscoverApp = new JosekiDiscoverApp(gameService, josekiDiscoverService, josekiLoader, favoriteService);

  const opponentAnalyzer = new OpponentAnalyzer(gameService, josekiDiscoverService, undefined, favoriteService);

  const decisionService = new DecisionService(config);
  const decisionApp = new DecisionApp(gameService, decisionService, favoriteService);

  return {
    playerQuerier,
    eventQuerier,
    fetcherApp,
    josekiDiscoverApp,
    opponentAnalyzer,
    decisionApp,
    decisionService,
    gameService,
    dataDir: WEIQI_DIR,
    loggerPlugin,
  };
}
