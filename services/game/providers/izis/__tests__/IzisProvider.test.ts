/**
 * @fileoverview izis围棋提供者测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IzisProvider } from '../IzisProvider';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { ISnifferProvider } from '../../../../infrastructure/network/interfaces/ISnifferProvider';

describe('IzisProvider', () => {
  let provider: IzisProvider;
  let mockSnifferProvider: ISnifferProvider;
  let mockNetwork: NetworkManager;

  beforeEach(() => {
    vi.clearAllMocks();

    mockNetwork = {} as NetworkManager;

    mockSnifferProvider = {
      name: 'playwright-sniffer',
      displayName: 'Playwright Sniffer',
      isAvailable: vi.fn().mockReturnValue(true),
      start: vi.fn(),
      getEnvironmentDescription: vi.fn().mockReturnValue('CLI 环境'),
    } as unknown as ISnifferProvider;

    provider = new IzisProvider(mockNetwork, mockSnifferProvider);
  });

  describe('基础信息', () => {
    it('应提供正确的名称和显示名称', () => {
      expect(provider.name).toBe('izis');
      expect(provider.displayName).toBe('隐智智能棋盘');
    });

    it('应检测支持的 URL', () => {
      expect(provider.canHandle('http://app.izis.cn/web/#/live_detail?gameId=12345&type=2')).toBe(true);
      expect(provider.canHandle('https://izis.cn/live?gameId=67890')).toBe(true);
      expect(provider.canHandle('https://online-go.com/game/12345')).toBe(false);
    });

    it('应从 URL 提取游戏 ID', () => {
      expect(provider.extractId('http://app.izis.cn/web/#/live_detail?gameId=12345&type=2')).toBe('12345');
      expect(provider.extractId('https://izis.cn/live?gameId=67890')).toBe('67890');
    });
  });

  describe('Sniffer 不可用', () => {
    it('Sniffer 不可用时应返回友好错误', async () => {
      vi.mocked(mockSnifferProvider.isAvailable).mockReturnValue(false);

      const result = await provider.fetch('http://app.izis.cn/web/#/live_detail?gameId=12345&type=2');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Sniffer');
    });
  });
});