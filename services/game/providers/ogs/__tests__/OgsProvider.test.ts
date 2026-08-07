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
    outcome: 'Resignation',
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

      // OGS: (15,3) → SGF: 'pd' (x=15→p, y=3→d, 无需翻转)
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

  describe('结果翻译', () => {
    it('应该将 Resignation 翻译为 SGF 标准格式', async () => {
      const result = await provider.fetch('https://online-go.com/game/12345');
      expect(result.success).toBe(true);
      // outcome: "Resignation", white_lost: true → "B+R"
      expect(result.metadata.result).toBe('B+R');
    });

    it('应该将 Timeout 翻译为 SGF 标准格式', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { ...mockGameResponse, outcome: 'Timeout', black_lost: true, white_lost: false },
        status: 200,
        ok: true,
      } as IResponse<OgsGameResponse>);

      const result = await provider.fetch('https://online-go.com/game/12345');
      expect(result.success).toBe(true);
      expect(result.metadata.result).toBe('W+T');
    });

    it('应该将纯数字 outcome 翻译为 SGF 标准格式', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { ...mockGameResponse, outcome: '2.5', black_lost: true, white_lost: false },
        status: 200,
        ok: true,
      } as IResponse<OgsGameResponse>);

      const result = await provider.fetch('https://online-go.com/game/12345');
      expect(result.success).toBe(true);
      expect(result.metadata.result).toBe('W+2.5');
    });

    it('应该将 "X points" 格式的 outcome 翻译为 SGF 标准格式', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { ...mockGameResponse, outcome: '17.5 points', black_lost: true, white_lost: false },
        status: 200,
        ok: true,
      } as IResponse<OgsGameResponse>);

      const result = await provider.fetch('https://online-go.com/game/12345');
      expect(result.success).toBe(true);
      expect(result.metadata.result).toBe('W+17.5');
    });

    it('应该将 "X point" 单数格式的 outcome 翻译', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { ...mockGameResponse, outcome: '1 point', white_lost: true, black_lost: false },
        status: 200,
        ok: true,
      } as IResponse<OgsGameResponse>);

      const result = await provider.fetch('https://online-go.com/game/12345');
      expect(result.success).toBe(true);
      expect(result.metadata.result).toBe('B+1');
    });

    it('没有 outcome 时应从 ended/black_lost/white_lost 推导', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { ...mockGameResponse, outcome: undefined, ended: '2024-01-15T11:00:00Z', black_lost: true, white_lost: false },
        status: 200,
        ok: true,
      } as IResponse<OgsGameResponse>);

      const result = await provider.fetch('https://online-go.com/game/12345');
      expect(result.success).toBe(true);
      expect(result.metadata.result).toBe('W+R');
    });
  });

});