/**
 * @fileoverview Game Provider 注册中心
 */

import type { IGameProvider } from './providers/base/IProvider';
import type { IFoxwqProvider } from './providers/foxwq/IFoxwqProvider';
import type { IGameHistoryStorage } from './IGameHistoryStorage';
import type { NetworkManager } from '../../infrastructure/network/core/NetworkManager';
import type { ISnifferProvider } from '../../infrastructure/network/interfaces/ISnifferProvider';
import { ArchiveProvider } from './providers/archive';
import { FoxwqProvider } from './providers/foxwq';
import { FoxwqShareProvider } from './providers/foxwq/FoxwqShareProvider';
import { OgsProvider } from './providers/ogs';
import { Weiqi101Provider } from './providers/weiqi101';
import { TxwqProvider } from './providers/txwq';
import { YikeProvider } from './providers/yike';
import { YikeOnlineGameProvider } from './providers/yike';
import { Weiqi1919Provider } from './providers/weiqi1919';
import { IzisProvider, IzisArchiveProvider } from './providers/izis';
import { XinboduiyiProvider } from './providers/xinboduiyi';
import { ShoutanProvider } from './providers/shoutan';
import { YichengProvider } from './providers/yicheng';
import { YikeShaoerProvider } from './providers/yike-shaoer';
import { YuanluoboProvider } from './providers/yuanluobo';
import { KatagoArchiveProvider } from './providers/katago';

export interface IProviderRegistryOptions {
  snifferProvider?: ISnifferProvider | undefined;
  historyStorage?: IGameHistoryStorage | undefined;
  proxyUrl?: string | undefined;
}

export class GameProviderRegistry {
  private providers: Map<string, IGameProvider> = new Map();
  private foxwqProvider!: IFoxwqProvider;
  private katagoProvider!: KatagoArchiveProvider;

  constructor(
    network: NetworkManager,
    options?: IProviderRegistryOptions
  ) {
    this.registerDefaultProviders(network, options?.snifferProvider, options?.historyStorage, options?.proxyUrl);
  }

  private registerDefaultProviders(network: NetworkManager, snifferProvider?: ISnifferProvider, historyStorage?: IGameHistoryStorage, proxyUrl?: string): void {
    // Foxwq（组合 Provider，用于用户查询等）
    this.foxwqProvider = new FoxwqProvider(network);

    // Foxwq 分享链接 Provider（支持 Sniffer fallback）
    this.providers.set('foxwq', new FoxwqShareProvider(network, snifferProvider));

    // KataGo Archive Provider
    this.katagoProvider = new KatagoArchiveProvider(network);

    // Archive Provider
    this.providers.set('archive', new ArchiveProvider());

    // REST API Providers（无需 Sniffer，所有环境支持）
    const restProviders = [
      new OgsProvider(network),
      new Weiqi101Provider(network),
      new ShoutanProvider(network),
      new YichengProvider(network),
      new YuanluoboProvider(network),
    ];
    restProviders.forEach(p => this.providers.set(p.name, p));

    // izis 非直播分享链接 Provider（无需 Sniffer，直接 HTTP 抓取）
    // 必须在 izis (直播) 之前注册，确保 /game_xxx.html 优先匹配到非直播提供者
    this.providers.set('izis-archive', new IzisArchiveProvider(network));

    // izis 直播 Provider（直接 API 调用，Sniffer 可选 fallback）
    // 始终注册：直接 HTTP POST 调用 getdataserver API，无需 Sniffer/Playwright
    this.providers.set('izis', new IzisProvider(network, snifferProvider, proxyUrl));

    // Sniffer Providers (如果可用，仅用于直播类 URL)
    if (snifferProvider) {
      this.registerSnifferProviders(network, snifferProvider);
    }
  }

  private registerSnifferProviders(network: NetworkManager, snifferProvider: ISnifferProvider): void {
    const snifferProviders = [
      new TxwqProvider(network, snifferProvider),
      new YikeProvider(network, snifferProvider), // 弈客直播 room
      new YikeOnlineGameProvider(network, snifferProvider), // 弈客 online-game（新增）
      new Weiqi1919Provider(network, snifferProvider),
      new XinboduiyiProvider(network, snifferProvider),
      new YikeShaoerProvider(network, snifferProvider),
    ];
    snifferProviders.forEach(p => this.providers.set(p.name, p));
  }

  getProviders(): Map<string, IGameProvider> {
    return this.providers;
  }

  getFoxwqProvider(): IFoxwqProvider {
    return this.foxwqProvider;
  }

  getKatagoProvider(): KatagoArchiveProvider {
    return this.katagoProvider;
  }

  register(provider: IGameProvider): void {
    this.providers.set(provider.name, provider);
  }

  unregister(name: string): void {
    this.providers.delete(name);
  }

  getSupportedProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}
