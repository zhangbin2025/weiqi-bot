/**
 * @fileoverview 弈客围棋提供者测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { YikeProvider } from '../YikeProvider';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { ISnifferProvider } from '../../../../infrastructure/network/interfaces/ISnifferProvider';

describe('YikeProvider', () => {
  let provider: YikeProvider;
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

    provider = new YikeProvider(mockNetwork, mockSnifferProvider);
  });

  describe('基础信息', () => {
    it('应提供正确的名称和显示名称', () => {
      expect(provider.name).toBe('yike');
      expect(provider.displayName).toBe('弈客围棋');
    });

    it('应检测支持的 URL', () => {
      expect(provider.canHandle('https://home.yikeweiqi.com/mobile.html#/golive/room/12345')).toBe(true);
      expect(provider.canHandle('https://yikeweiqi.com/room/67890')).toBe(true);
      expect(provider.canHandle('https://online-go.com/game/12345')).toBe(false);
    });

    it('应从 URL 提取房间 ID', () => {
      expect(provider.extractId('https://home.yikeweiqi.com/mobile.html#/golive/room/12345')).toBe('12345');
      expect(provider.extractId('https://yikeweiqi.com/room/67890')).toBe('67890');
    });
  });

  describe('Sniffer 不可用', () => {
    it('Sniffer 不可用时应返回友好错误', async () => {
      vi.mocked(mockSnifferProvider.isAvailable).mockReturnValue(false);

      const result = await provider.fetch('https://home.yikeweiqi.com/mobile.html#/golive/room/12345');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Sniffer');
    });
  });
});