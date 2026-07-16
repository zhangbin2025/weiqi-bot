/**
 * @fileoverview 腾讯围棋提供者测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TxwqProvider } from '../TxwqProvider';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { ISnifferProvider } from '../../../../infrastructure/network/interfaces/ISnifferProvider';

describe('TxwqProvider', () => {
  let provider: TxwqProvider;
  let mockSnifferProvider: ISnifferProvider;
  let mockNetwork: NetworkManager;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock network
    mockNetwork = {} as NetworkManager;

    // Mock sniffer provider
    mockSnifferProvider = {
      name: 'playwright-sniffer',
      displayName: 'Playwright Sniffer',
      isAvailable: vi.fn().mockReturnValue(true),
      start: vi.fn(),
      getEnvironmentDescription: vi.fn().mockReturnValue('CLI 环境'),
    } as unknown as ISnifferProvider;

    provider = new TxwqProvider(mockNetwork, mockSnifferProvider);
  });

  describe('基础信息', () => {
    it('应提供正确的名称和显示名称', () => {
      expect(provider.name).toBe('txwq');
      expect(provider.displayName).toBe('腾讯围棋');
    });

    it('应检测支持的 URL', () => {
      expect(provider.canHandle('https://h5.txwq.qq.com/txwqshare/index.html?chessid=12345')).toBe(true);
      expect(provider.canHandle('https://txwq.qq.com/share?chessid=67890')).toBe(true);
      expect(provider.canHandle('https://online-go.com/game/12345')).toBe(false);
    });

    it('应从 URL 提取 chessid', () => {
      expect(provider.extractId('https://h5.txwq.qq.com/txwqshare/index.html?chessid=12345')).toBe('12345');
      expect(provider.extractId('https://txwq.qq.com/share?chessid=67890')).toBe('67890');
      expect(provider.extractId('https://online-go.com/game/12345')).toBe(null);
    });
  });

  describe('Sniffer 不可用', () => {
    it('Sniffer 不可用时应返回友好错误', async () => {
      vi.mocked(mockSnifferProvider.isAvailable).mockReturnValue(false);

      const result = await provider.fetch('https://h5.txwq.qq.com/txwqshare/index.html?chessid=12345');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Sniffer');
    });
  });

  describe('Sniffer 可用', () => {
    it('应正确处理无效 URL', async () => {
      const result = await provider.fetch('https://invalid-url.com');

      expect(result.success).toBe(false);
      expect(result.error).toContain('无法从 URL 提取 chessid');
    });
  });
});