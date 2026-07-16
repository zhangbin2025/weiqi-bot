/**
 * @fileoverview YikeShaoerProvider 测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { YikeShaoerProvider } from '../YikeShaoerProvider';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { ISnifferProvider } from '../../../../infrastructure/network/interfaces/ISnifferProvider';

describe('YikeShaoerProvider', () => {
  let provider: YikeShaoerProvider;
  let mockNetwork: NetworkManager;
  let mockSniffer: ISnifferProvider;

  beforeEach(() => {
    vi.clearAllMocks();

    mockNetwork = {} as NetworkManager;

    mockSniffer = {
      name: 'mock-sniffer',
      displayName: 'Mock Sniffer',
      isAvailable: vi.fn().mockReturnValue(true),
      start: vi.fn(),
      getEnvironmentDescription: vi.fn().mockReturnValue('CLI 环境'),
    } as unknown as ISnifferProvider;

    provider = new YikeShaoerProvider(mockNetwork, mockSniffer);
  });

  describe('URL 检测', () => {
    it('应识别弈客少儿 URL 格式', () => {
      const url = 'https://shaoer.yikeweiqi.com/statichtml/game_analysis_mobile.html?p=abc123';
      expect(provider.canHandle(url)).toBe(true);
    });

    it('应拒绝不匹配的 URL', () => {
      const url = 'https://yikeweiqi.com/game/123';
      expect(provider.canHandle(url)).toBe(false);
    });
  });

  describe('Sniffer 检测', () => {
    it('应在 Sniffer 不可用时返回错误', async () => {
      vi.mocked(mockSniffer.isAvailable).mockReturnValue(false);

      const providerNoSniffer = new YikeShaoerProvider(mockNetwork, mockSniffer);

      const url = 'https://shaoer.yikeweiqi.com/statichtml/game_analysis_mobile.html?p=abc123';
      const result = await providerNoSniffer.fetch(url);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Sniffer');
    });
  });

  describe('ID 提取', () => {
    it('应正确提取编码参数', () => {
      const url = 'https://shaoer.yikeweiqi.com/statichtml/game_analysis_mobile.html?p=abc123';
      expect(provider.extractId(url)).toBe('abc123');
    });
  });
});