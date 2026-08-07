/**
 * 不支持的 Sniffer 提供者
 * @description 用于不支持抓包的环境（如 Web 浏览器）
 */

import type {
  ISnifferProvider,
  ISnifferSession,
} from '../../interfaces/ISnifferProvider';
import type {
  SnifferMessage,
  SnifferOptions,
  SnifferResult,
} from '../../interfaces/SnifferTypes';

/**
 * 不支持的 Sniffer 会话
 */
export class UnsupportedSnifferSession implements ISnifferSession {
  readonly id = 'unsupported';
  readonly url: string;
  readonly status = 'error' as const;

  constructor(url: string) {
    this.url = url;
  }

  onMessage(_callback: (message: SnifferMessage) => void): void {
    // 不支持
  }

  onError(_callback: (error: Error) => void): void {
    // 不支持
  }

  async wait(_timeout?: number): Promise<SnifferResult> {
    return {
      success: false,
      sessionId: this.id,
      messages: [],
      error: '当前环境不支持此请求。',
    };
  }

  async stop(): Promise<void> {
    // 不支持
  }

  getMessages(): SnifferMessage[] {
    return [];
  }
}

/**
 * 不支持的 Sniffer 提供者
 */
export class UnsupportedSnifferProvider implements ISnifferProvider {
  readonly name = 'unsupported-sniffer';
  readonly displayName = '不支持的环境';

  async start(url: string, _options?: SnifferOptions): Promise<ISnifferSession> {
    return new UnsupportedSnifferSession(url);
  }

  isAvailable(): boolean {
    return false;
  }

  getEnvironmentDescription(): string {
    return '当前环境不支持此请求。';
  }
}
