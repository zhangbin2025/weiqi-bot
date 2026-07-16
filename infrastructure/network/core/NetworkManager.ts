/** 网络管理器 - 网络层的统一入口 */

import { ProviderRegistry } from './ProviderRegistry';
import { EnvironmentDetector } from './EnvironmentDetector';
import { DefaultNetworkStrategy } from './DefaultNetworkStrategy';
import { PluginManager } from './PluginManager';
import { PluginOperations } from './PluginOperations';
import { ConnectionOperations } from './ConnectionOperations';
import { applyNetworkConfigDefaults } from './NetworkConfigDefaults';
import { NetworkLoggerPlugin } from '../plugins/NetworkLogger';
import type { INetworkLogEntry } from '../plugins/NetworkLogger';
import type {
  Environment,
  IUserContext,
  IRequestConfig,
  IResponse,
  IWebSocket,
  IWebSocketOptions,
  IWebRTC,
  IWebRTCConfig,
  INetworkProvider,
  INetworkPlugin
} from '../interfaces';
import type { INetworkConfig } from '../../config/schemas/NetworkConfigSchema';

/** 网络管理器 - 网络层的核心协调器 */
export class NetworkManager {
  private registry: ProviderRegistry;
  private detector: EnvironmentDetector;
  private strategy: DefaultNetworkStrategy;
  private pluginManager: PluginManager;
  private pluginOps: PluginOperations;
  private connectionOps: ConnectionOperations;
  private userContext?: IUserContext;
  private currentEnvironment: Environment;
  private config: INetworkConfig;
  private tracer: NetworkLoggerPlugin | undefined;

  constructor(config: Partial<INetworkConfig> = {}) {
    this.config = {
      defaultTimeout: config.defaultTimeout ?? 30000,
      retryCount: config.retryCount ?? 3,
      enableCache: config.enableCache ?? true,
    };

    this.registry = new ProviderRegistry();
    this.detector = new EnvironmentDetector();
    this.strategy = new DefaultNetworkStrategy();
    this.pluginManager = new PluginManager(this.registry);
    this.pluginOps = new PluginOperations(
      this.pluginManager,
      this.registry,
      this.strategy
    );
    this.connectionOps = new ConnectionOperations(
      this.registry,
      this.strategy,
      () => this.currentEnvironment,
      () => this.userContext
    );
    this.currentEnvironment = this.detector.detect();
  }

  /** 初始化网络管理器 */
  async initialize(): Promise<void> {
    this.currentEnvironment = this.detector.detect();
    await this.registerDefaultProviders();
    this.strategy.setProviders(this.registry.getProviders());
  }

  /** 发起 HTTP 请求 */
  async request<T>(config: IRequestConfig): Promise<IResponse<T>> {
    if (!this.userContext) {
      throw new Error('User context not set');
    }

    const requestConfig = applyNetworkConfigDefaults(config, this.config);
    const provider = await this.strategy.selectProvider(
      this.currentEnvironment,
      this.userContext,
      requestConfig
    );

    // If provider is null or UnsupportedProvider, use fallback
    if (!provider || provider.name === 'UnsupportedProvider') {
      return this.registry.requestWithFallback(
        requestConfig,
        this.currentEnvironment
      );
    }

    return provider.request<T>(requestConfig);
  }

  /** 便捷 fetch 方法 */
  async fetch(url: string, init?: RequestInit): Promise<Response> {
    return globalThis.fetch(url, init);
  }

  async connect(url: string, options?: IWebSocketOptions): Promise<IWebSocket> {
    return this.connectionOps.connect(url, options);
  }

  /** 创建 WebRTC P2P 连接 */
  async createP2PConnection(config: IWebRTCConfig): Promise<IWebRTC> {
    return this.connectionOps.createP2PConnection(config);
  }

  /** 注册网络提供者 */
  registerProvider(provider: INetworkProvider): void {
    this.registry.register(provider);
    this.strategy.setProviders(this.registry.getProviders());
  }

  /** 注销网络提供者 */
  unregisterProvider(name: string): void {
    this.registry.unregister(name);
    this.strategy.setProviders(this.registry.getProviders());
  }

  /** 设置用户上下文 */
  setUserContext(context: IUserContext): void {
    this.userContext = context;
  }

  /** 获取当前环境 */
  getEnvironment(): Environment {
    return this.currentEnvironment;
  }

  /** 获取当前配置 */
  getConfig(): Readonly<INetworkConfig> {
    return this.config;
  }

  /** 获取指定名称的提供者 */
  getProvider(name: string): INetworkProvider | undefined {
    return this.registry.getProvider(name);
  }

  /** 加载插件 */
  async loadPlugin(plugin: INetworkPlugin): Promise<void> {
    await this.pluginOps.loadPlugin(plugin);
    this.strategy.setProviders(this.registry.getProviders());
  }

  /** 卸载插件 */
  async unloadPlugin(name: string): Promise<void> {
    await this.pluginOps.unloadPlugin(name);
    this.strategy.setProviders(this.registry.getProviders());
  }

  /** 获取所有插件 */
  getPlugins(): INetworkPlugin[] {
    return this.pluginOps.getPlugins();
  }

  /** 获取插件 */
  getPlugin(name: string): INetworkPlugin | undefined {
    return this.pluginOps.getPlugin(name);
  }

  /** 检查插件是否已加载 */
  hasPlugin(name: string): boolean {
    return this.pluginOps.hasPlugin(name);
  }

  /** 开启网络请求跟踪 */
  enableTracing(handler?: (entry: INetworkLogEntry) => void): void {
    if (this.tracer) return;
    // const logger = LogManager.createLogger('network-trace');
    this.tracer = new NetworkLoggerPlugin({
      logRequestBody: true,
      logResponseBody: false,
      customHandler: handler ?? ((entry: INetworkLogEntry) => {
        const status = entry.response?.status ?? '???';
        const duration = entry.response?.duration ?? 0;
        console.info(`[${entry.request.method}] ${entry.request.url} → ${status} (${duration}ms)`);
      }),
    });
    this.loadPlugin(this.tracer);
  }

  /** 关闭网络请求跟踪 */
  disableTracing(): void {
    if (!this.tracer) return;
    this.unloadPlugin(this.tracer.name);
    this.tracer = undefined;
  }

  /** 注册默认提供者 */
  private async registerDefaultProviders(): Promise<void> {
    // 根据环境注册不同的提供者，实际实现中应该根据环境动态加载
    // 示例：
    // if (this.currentEnvironment === Environment.WEB) {
    //   const { WebRTCProvider } = await import('../adapters/common/WebRTCProvider');
    //   this.registry.register(new WebRTCProvider(...));
    // }
  }
}
