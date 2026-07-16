/**
 * @fileoverview 新博对弈提供者测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { XinboduiyiProvider } from '../XinboduiyiProvider';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { ISnifferProvider } from '../../../../infrastructure/network/interfaces/ISnifferProvider';

describe('XinboduiyiProvider', () => {
  let provider: XinboduiyiProvider;
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

    provider = new XinboduiyiProvider(mockNetwork, mockSnifferProvider);
  });

  describe('基础信息', () => {
    it('应提供正确的名称和显示名称', () => {
      expect(provider.name).toBe('xinboduiyi');
      expect(provider.displayName).toBe('新博对弈');
    });

    it('应检测支持的 URL', () => {
      expect(provider.canHandle('https://www.xinboduiyi.com/play-room?id=12345')).toBe(true);
      expect(provider.canHandle('https://weiqi.xinboduiyi.com/golive/index.html#/?gamekey=abc123')).toBe(true);
      expect(provider.canHandle('https://online-go.com/game/12345')).toBe(false);
    });

    it('应从 URL 提取对局 ID', () => {
      expect(provider.extractId('https://www.xinboduiyi.com/play-room?id=12345')).toBe('12345');
      expect(provider.extractId('https://weiqi.xinboduiyi.com/golive/index.html#/?gamekey=abc123')).toBe('abc123');
    });
  });

  describe('Sniffer 不可用', () => {
    it('Sniffer 不可用时应返回友好错误', async () => {
      vi.mocked(mockSnifferProvider.isAvailable).mockReturnValue(false);

      const result = await provider.fetch('https://www.xinboduiyi.com/play-room?id=12345');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Sniffer');
    });
  });
});