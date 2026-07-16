/**
 * @fileoverview 101围棋网 Provider 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Weiqi101Provider } from '../Weiqi101Provider';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { IResponse } from '../../../../infrastructure/network/interfaces';

describe('Weiqi101Provider', () => {
  let provider: Weiqi101Provider;
  let mockNetwork: NetworkManager;

  const mockHtml = `
    <html>
      <script>
        var playInfo = {
          id: 12345,
          sockethost: "wss://socket.101weiqi.com",
          userkey: "test-key",
          busername: "BlackPlayer",
          wusername: "WhitePlayer",
          blacklevelname: "9d",
          whitelevelname: "8d",
          lu: 19,
          daotiemu: 7.5,
          rangzi: 0,
          gamerule: 1,
          step: 150,
          status: 1,
          points: ["pd", "dd", "pp"]
        }, language = "zh";
      </script>
    </html>
  `;

  beforeEach(() => {
    mockNetwork = {
      request: vi.fn().mockResolvedValue({
        data: mockHtml,
        status: 200,
        ok: true,
      } as IResponse<string>),
    } as unknown as NetworkManager;

    provider = new Weiqi101Provider(mockNetwork);
  });

  describe('canHandle', () => {
    it('应该识别 101weiqi.com URL', () => {
      expect(
        provider.canHandle('https://www.101weiqi.com/play/p/12345/')
      ).toBe(true);
    });

    it('应该识别简化 URL', () => {
      expect(provider.canHandle('https://www.101weiqi.com/play/12345')).toBe(
        true
      );
    });

    it('应该识别 101weiqi.cn URL', () => {
      expect(provider.canHandle('https://www.101weiqi.cn/play/p/12345/')).toBe(
        true
      );
    });

    it('应该拒绝其他 URL', () => {
      expect(provider.canHandle('https://example.com/game/12345')).toBe(false);
    });
  });

  describe('extractId', () => {
    it('应该从 play/p/{ID} URL 提取 ID', () => {
      expect(
        provider.extractId('https://www.101weiqi.com/play/p/12345/')
      ).toBe('12345');
    });

    it('应该从 play/{ID} URL 提取 ID', () => {
      expect(provider.extractId('https://www.101weiqi.com/play/67890')).toBe(
        '67890'
      );
    });

    it('应该对无效 URL 返回 null', () => {
      expect(provider.extractId('https://example.com/game/12345')).toBeNull();
    });
  });

  describe('fetch', () => {
    it('应该成功下载棋谱（不使用 WebSocket）', async () => {
      const result = await provider.fetch(
        'https://www.101weiqi.com/play/p/12345/'
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.source).toBe('weiqi101');
      expect(result.metadata.gameId).toBe('12345');
      expect(result.sgfContent).toBeTruthy();
      expect(result.error).toBeUndefined();
    });

    it('应该处理无效 URL', async () => {
      const result = await provider.fetch('https://invalid-url.com');

      expect(result.success).toBe(false);
      expect(result.error).toContain('无法从 URL 提取对局 ID');
    });

    it('应该处理网络错误', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Network error')
      );

      const result = await provider.fetch(
        'https://www.101weiqi.com/play/p/12345/'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('下载失败');
    });
  });

  describe('fetchById', () => {
    it('应该通过 ID 获取游戏数据', async () => {
      const result = await provider.fetchById('12345');

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.metadata.gameId).toBe('12345');
      expect(result.sgfContent).toBeTruthy();
    });
  });
});