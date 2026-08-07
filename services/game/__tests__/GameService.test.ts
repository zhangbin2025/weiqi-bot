/**
 * @fileoverview GameService 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameService } from '../GameService';
import type { NetworkManager } from '../../../infrastructure/network/core/NetworkManager';
import type { IConfigProvider } from '../../../infrastructure/config/interfaces/IConfigProvider';

describe('GameService', () => {
  let service: GameService;
  let mockNetwork: NetworkManager;
  let mockConfig: IConfigProvider;

  beforeEach(() => {
    mockNetwork = {
      request: vi.fn().mockResolvedValue({
        data: {
          id: 12345,
          gamedata: {
            width: 19,
            height: 19,
            komi: 6.5,
            handicap: 0,
            rules: 'japanese',
            moves: [[15, 3], [3, 15]],
          },
          players: {
            black: { username: 'BlackPlayer' },
            white: { username: 'WhitePlayer' },
          },
          started: '2024-01-15T10:00:00Z',
        },
        status: 200,
        ok: true,
      }),
    } as unknown as NetworkManager;

    mockConfig = {
      getModuleConfig: vi.fn().mockResolvedValue({
        ogsApiUrl: 'https://online-go.com/api/v1',
        weiqi101BaseUrl: 'https://www.101weiqi.com',
        foxwqBaseUrl: 'https://newframe.foxwq.com/cgi',
        proxyUrl: 'https://proxy.example.com',
        timeout: 30000,
        enableWebSocket: false,
      }),
    } as unknown as IConfigProvider;

    service = new GameService(mockNetwork, { configProvider: mockConfig });
  });

  describe('canHandle', () => {
    it('应该识别 OGS URL', () => {
      expect(service.canHandle('https://online-go.com/game/12345')).toBe(true);
    });

    it('应该识别 101围棋 URL', () => {
      expect(
        service.canHandle('https://www.101weiqi.com/play/p/12345/')
      ).toBe(true);
    });

    it('应该拒绝未知 URL', () => {
      expect(service.canHandle('https://example.com/game/12345')).toBe(false);
    });
  });

  describe('getSupportedProviders', () => {
    it('应该返回支持的提供者列表', () => {
      const providers = service.getSupportedProviders();

      expect(providers).toContain('ogs');
      expect(providers).toContain('weiqi101');
    });
  });

  describe('fetch', () => {
    it('应该路由到正确的提供者', async () => {
      const result = await service.fetch(
        'https://online-go.com/game/12345'
      );

      expect(result.source).toBe('ogs');
    });

    it('应该处理不支持的 URL', async () => {
      const result = await service.fetch('https://example.com/game/12345');

      expect(result.success).toBe(false);
      expect(result.error).toContain('不支持');
    });
  });

  describe('configProvider', () => {
    it('应该支持不传 configProvider（使用默认配置）', () => {
      const svc = new GameService(mockNetwork);
      expect(svc.canHandle('https://online-go.com/game/12345')).toBe(true);
    });

    it('应该通过 options 传入 configProvider', () => {
      const svc = new GameService(mockNetwork, { configProvider: mockConfig });
      expect(svc.canHandle('https://online-go.com/game/12345')).toBe(true);
    });
  });
});