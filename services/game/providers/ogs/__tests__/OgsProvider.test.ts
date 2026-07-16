/**
 * @fileoverview OGS Provider 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OgsProvider } from '../OgsProvider';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { IResponse } from '../../../../infrastructure/network/interfaces';
import type { OgsGameResponse } from '../types';

describe('OgsProvider', () => {
  let provider: OgsProvider;
  let mockNetwork: NetworkManager;

  const mockGameResponse: OgsGameResponse = {
    id: 12345,
    gamedata: {
      width: 19,
      height: 19,
      komi: 6.5,
      handicap: 0,
      rules: 'japanese',
      moves: [[15, 3], [3, 15], [15, 15]],
    },
    players: {
      black: { username: 'BlackPlayer', ranking: 1800 },
      white: { username: 'WhitePlayer', ranking: 1700 },
    },
    started: '2024-01-15T10:00:00Z',
    outcome: 'B+Resign',
    black_lost: false,
    white_lost: true,
  };

  beforeEach(() => {
    mockNetwork = {
      request: vi.fn().mockResolvedValue({
        data: mockGameResponse,
        status: 200,
        ok: true,
      } as IResponse<OgsGameResponse>),
    } as unknown as NetworkManager;

    provider = new OgsProvider(mockNetwork);
  });

  describe('canHandle', () => {
    it('应该识别标准游戏 URL', () => {
      expect(provider.canHandle('https://online-go.com/game/12345')).toBe(
        true
      );
    });

    it('应该识别游戏视图 URL', () => {
      expect(provider.canHandle('https://online-go.com/game/view/12345')).toBe(
        true
      );
    });

    it('应该拒绝其他 URL', () => {
      expect(provider.canHandle('https://example.com/game/12345')).toBe(false);
    });
  });

  describe('extractId', () => {
    it('应该从标准 URL 提取游戏 ID', () => {
      expect(provider.extractId('https://online-go.com/game/12345')).toBe(
        '12345'
      );
    });

    it('应该从视图 URL 提取游戏 ID', () => {
      expect(
        provider.extractId('https://online-go.com/game/view/67890')
      ).toBe('67890');
    });

    it('应该对无效 URL 返回 null', () => {
      expect(provider.extractId('https://example.com/game/12345')).toBeNull();
    });
  });

  describe('fetch', () => {
    it('应该成功下载棋谱', async () => {
      const result = await provider.fetch(
        'https://online-go.com/game/12345'
      );

      expect(result.success).toBe(true);
      expect(result.source).toBe('ogs');
      expect(result.sgfContent).toContain('PB[BlackPlayer]');
      expect(result.sgfContent).toContain('PW[WhitePlayer]');
      expect(result.metadata.gameId).toBe('12345');
    });

    it('应该正确转换坐标（左上 → 左下）', async () => {
      const result = await provider.fetch(
        'https://online-go.com/game/12345'
      );

      // OGS: (15,3) → SGF: 'pd' (16-1=15, 19-1-3=15)
      expect(result.sgfContent).toContain('B[pd]');
    });

    it('应该处理无效 URL', async () => {
      const result = await provider.fetch('https://invalid-url.com');

      expect(result.success).toBe(false);
      expect(result.error).toContain('无法从 URL 提取游戏 ID');
    });

    it('应该处理 API 错误', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Network error')
      );

      const result = await provider.fetch(
        'https://online-go.com/game/12345'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('下载失败');
    });

    it('应该处理空响应', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: null,
        status: 200,
        ok: true,
      } as IResponse<OgsGameResponse>);

      const result = await provider.fetch(
        'https://online-go.com/game/12345'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('API 响应为空');
    });
  });

  describe('fetchById', () => {
    it('应该通过 ID 获取游戏数据', async () => {
      const result = await provider.fetchById('12345');

      expect(result.success).toBe(true);
      expect(result.metadata.gameId).toBe('12345');
    });
  });
});