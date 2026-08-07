/**
 * 不支持的网络提供者
 * @description 返回友好的不支持提示，用于降级策略
 * @ai-example
 * const provider = new UnsupportedProvider('web', { playwright: false });
 * await provider.request({ url: 'https://example.com' });
 * // throws NetworkError with friendly message
 */

import { BaseProvider } from './BaseProvider';
import type {
  IRequestConfig,
  IResponse,
  IWebSocket,
  IWebSocketOptions,
  Environment
} from '../../interfaces';
import { NetworkError } from '../../interfaces';
import type { PlatformCapabilities } from '../../../platform/interfaces/PlatformTypes';

/** Playwright 平台列表 */
const PLAYWRIGHT_PLATFORMS = [
  'txwq.qq.com',
  'h5.txwq.qq.com',
  'yikeweiqi.com/game',
  '1919weiqi.com',
  'izis.cn',
  'xinboduiyi.com',
  'shaoer.yikeweiqi.com'
];

/**
 * 不支持的提供者
 *
 * 用于返回友好的不支持提示，避免崩溃
 */
export class UnsupportedProvider extends BaseProvider {
  private readonly environment: Environment;
  private readonly capabilities: PlatformCapabilities;
  private readonly targetUrl?: string | undefined;

  constructor(
    environment: Environment,
    capabilities: PlatformCapabilities,
    targetUrl?: string
  ) {
    super({
      name: 'UnsupportedProvider',
      priority: -1,
      supportedEnvironments: []
    });

    this.environment = environment;
    this.capabilities = capabilities;
    this.targetUrl = targetUrl;
  }

  /**
   * 发起 HTTP 请求（始终抛出不支持错误）
   */
  async request<T>(_config: IRequestConfig): Promise<IResponse<T>> {
    throw new NetworkError(
      this.getUnsupportedMessage(),
      'UNSUPPORTED_PLATFORM',
      this.name
    );
  }

  /**
   * 建立 WebSocket 连接（始终抛出不支持错误）
   */
  override async connect(_url: string, _options?: IWebSocketOptions): Promise<IWebSocket> {
    throw new NetworkError(
      this.getUnsupportedMessage(),
      'UNSUPPORTED_PLATFORM',
      this.name
    );
  }

  /**
   * 获取不支持提示消息
   */
  private getUnsupportedMessage(): string {
    return '当前环境不支持此请求。';
  }

  /**
   * 判断是否需要 Playwright
   */
  private needsPlaywright(): boolean {
    if (!this.targetUrl) return false;
    return PLAYWRIGHT_PLATFORMS.some(p => this.targetUrl?.includes(p));
  }

  /**
   * 检查可用性（始终返回 false）
   */
  override async isAvailable(): Promise<boolean> {
    return false;
  }

  /**
   * 健康检查（始终返回 false）
   */
  override async healthCheck(): Promise<boolean> {
    return false;
  }
}

/**
 * 创建不支持的提供者
 */
export function createUnsupportedProvider(
  environment: Environment,
  capabilities: PlatformCapabilities,
  targetUrl?: string
): UnsupportedProvider {
  return new UnsupportedProvider(environment, capabilities, targetUrl);
}
