/**
 * CLI 环境引导 + 应用层编排器组装
 * @module clients/cli/bootstrap
 * @description 初始化基础设施（NetworkManager、ConfigProvider、Cache），
 *              并组装应用层编排器（PlayerQuerier、EventQuerier）。
 *              命令文件只与编排器交互，不直接接触服务层。
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

import { NetworkManager } from '../../infrastructure/network/core/NetworkManager';
import { UserType } from '../../infrastructure/network/interfaces/UserType';
import { DirectProvider } from '../../infrastructure/network/adapters/web/DirectProvider';
import { ProxyProvider } from '../../infrastructure/network/adapters/web/ProxyProvider';
import { JsonFileAdapter } from '../../infrastructure/storage/adapters/cli/JsonFileAdapter';
import type { IConfigProvider } from '../../infrastructure/config/interfaces/IConfigProvider';
import type { ConfigKey, ConfigNamespace, ConfigChangeListener } from '../../infrastructure/config/interfaces/types';

import { PlayerQuerier } from '../../application/player/PlayerQuerier';
import { EventQuerier } from '../../application/event/EventQuerier';

// 编排器组装所需的服务层/领域层依赖（仅 bootstrap 可见）
import { PlayerService } from '../../services/player/PlayerService';
import { EventService } from '../../services/event/EventService';
import { RankingCalculator } from '../../domain/ranking/RankingCalculator';
import { FavoriteService } from '../../services/favorite/FavoriteService';
import { NetworkLoggerPlugin } from '../../infrastructure/network/plugins/NetworkLogger';

/** CLI 运行时上下文 */
export interface CliContext {
  /** 棋手查询编排器 */
  playerQuerier: PlayerQuerier;
  /** 赛事查询编排器 */
  eventQuerier: EventQuerier;
  /** 网络日志插件（仅 debug 模式） */
  loggerPlugin?: NetworkLoggerPlugin;
}

/** 默认代理地址 */
const DEFAULT_PROXY_URL = 'https://api.weiqi.lol';

/** CLI 专用棋手模块配置：Node.js 环境无 CORS 限制，直连即可 */
const DEFAULT_PLAYER_CONFIG = {
  proxyUrl: '',                              // CLI 无需代理
  shoutanBaseUrl: 'https://v.dzqzd.com/SpBody.aspx',
  yichafenBaseUrl: '',
  timeout: 30000,
  playerCacheTTL: 3600000,
  enablePlayerCache: true,
};

/** CLI 专用赛事模块配置 */
const DEFAULT_EVENT_CONFIG = {
  proxyUrl: '',                              // CLI 无需代理
  eventsBaseUrl: 'https://data-center.yunbisai.com/api/lswl-events',
  groupsBaseUrl: 'https://open.yunbisai.com/api/event/feel/list',
  againstPlanBaseUrl: 'https://api.yunbisai.com/request/Group/Againstplan',
  timeout: 30000,
  eventCacheTTL: 1800000,
  enableEventCache: true,
};

/** CLI 默认模块配置 */
const DEFAULT_MODULE_CONFIGS: Record<string, Record<string, unknown>> = {
  player: DEFAULT_PLAYER_CONFIG,
  event: DEFAULT_EVENT_CONFIG,
};

/**
 * 简单内存配置提供者
 * @description CLI 环境使用，仅支持 getModuleConfig
 */
class CliConfigProvider implements IConfigProvider {
  private readonly moduleConfigs: Record<string, Record<string, unknown>>;

  constructor(moduleConfigs?: Record<string, Record<string, unknown>>) {
    this.moduleConfigs = moduleConfigs ?? {};
  }

  async get<T>(_key: ConfigKey): Promise<T | undefined> { return undefined; }
  async set<T>(_key: ConfigKey, _value: T): Promise<void> { /* no-op */ }
  async getModuleConfig<T>(module: ConfigNamespace): Promise<T> {
    return (this.moduleConfigs[module] ?? {}) as T;
  }
  async setModuleConfig<T>(_module: ConfigNamespace, _config: Partial<T>): Promise<void> { /* no-op */ }
  onChange<T>(_key: ConfigKey, _callback: ConfigChangeListener<T>): () => void { return () => {}; }
  async reset(_key?: ConfigKey): Promise<void> { /* no-op */ }
  async has(_key: ConfigKey): Promise<boolean> { return false; }
  async delete(_key: ConfigKey): Promise<void> { /* no-op */ }
  registerSchema(_namespace: ConfigNamespace, _schema: unknown): void { /* no-op */ }
}

/**
 * 创建 CLI 运行时上下文
 * @param debug - 是否启用调试模式
 * @param proxyUrl - 代理服务器 URL
 * @param moduleConfigs - 模块配置映射
 * @returns 包含应用层编排器的上下文
 */
export async function createCliContext(
  debug?: boolean,
  proxyUrl?: string,
  moduleConfigs?: Record<string, Record<string, unknown>>,
): Promise<CliContext> {
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

  // debug 模式：注册 NetworkLoggerPlugin，customHandler 实时打印每个请求
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
  fs.mkdirSync(PLAYER_DIR, { recursive: true });

  // ── 存储适配器 ──
  const cache = new JsonFileAdapter(path.join(PLAYER_DIR, 'cache.json'));
  await cache.initialize();

  const favoritesStorage = new JsonFileAdapter(path.join(WEIQI_DIR, 'favorites.json'));
  await favoritesStorage.initialize();

  const config = new CliConfigProvider(resolvedModuleConfigs);

  // ── 2. 应用层编排器组装 ──
  // Service / Domain 类是编排器的构造参数（依赖注入），
  // CLI 命令文件只接触编排器，不直接使用服务层。

  const favoriteService = new FavoriteService(favoritesStorage);
  const playerQuerier = new PlayerQuerier(new PlayerService(network, cache, config), favoriteService);
  const eventQuerier = new EventQuerier(new EventService(network, cache, config), new RankingCalculator(), favoriteService);

  return { playerQuerier, eventQuerier, loggerPlugin };
}
