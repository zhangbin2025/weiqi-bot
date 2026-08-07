/**
 * @fileoverview 1919围棋提供者测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Weiqi1919Provider } from '../Weiqi1919Provider';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { ISnifferProvider } from '../../../../infrastructure/network/interfaces/ISnifferProvider';

describe('Weiqi1919Provider', () => {
  let provider: Weiqi1919Provider;
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

    provider = new Weiqi1919Provider(mockNetwork, mockSnifferProvider);
  });

  describe('基础信息', () => {
    it('应提供正确的名称和显示名称', () => {
      expect(provider.name).toBe('weiqi1919');
      expect(provider.displayName).toBe('1919围棋');
    });

    it('应检测支持的 URL', () => {
      expect(provider.canHandle('https://m.19x19.com/app/dark/zh/sgf/12345')).toBe(true);
      expect(provider.canHandle('https://golaxy.com/sgf/67890')).toBe(true);
      expect(provider.canHandle('https://online-go.com/game/12345')).toBe(false);
    });

    it('应从 URL 提取棋谱 ID', () => {
      expect(provider.extractId('https://m.19x19.com/app/dark/zh/sgf/12345')).toBe('12345');
      expect(provider.extractId('https://golaxy.com/sgf/67890')).toBe('67890');
    });
  });

  describe('Sniffer 不可用', () => {
    it('Sniffer 不可用时应返回友好错误', async () => {
      vi.mocked(mockSnifferProvider.isAvailable).mockReturnValue(false);

      const result = await provider.fetch('https://m.19x19.com/app/dark/zh/sgf/12345');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Sniffer');
    });
  });
});