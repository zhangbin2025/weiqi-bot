/**
 * @fileoverview FoxwqProvider 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FoxwqProvider } from '../index';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';
import type { IResponse } from '../../../../infrastructure/network/interfaces';

describe('FoxwqProvider', () => {
  let provider: FoxwqProvider;
  let mockNetwork: NetworkManager;

  beforeEach(() => {
    vi.clearAllMocks();

    mockNetwork = {
      request: vi.fn(),
    } as unknown as NetworkManager;

    provider = new FoxwqProvider(mockNetwork);
  });

  describe('queryUserByName', () => {
    it('should fetch user from API', async () => {
      vi.mocked(mockNetwork.request).mockResolvedValue({
        data: {
          result: 0,
          uid: '123456',
          username: '柯洁',
          dan: 105,
          totalwin: 100,
          totallost: 20,
          totalequal: 5,
        },
        status: 200,
      } as IResponse<{ result: number; uid: string; username: string; dan: number }>);

      const result = await provider.queryUserByName('柯洁');

      expect(result.uid).toBe('123456');
      expect(result.nickname).toBe('柯洁');
      expect(result.dan).toBe(105);
    });

    it('should throw error if user not found', async () => {
      vi.mocked(mockNetwork.request).mockResolvedValue({
        data: { result: 1, resultstr: '用户不存在' },
        status: 200,
      } as IResponse<{ result: number; resultstr: string }>);

      await expect(provider.queryUserByName('不存在的用户')).rejects.toThrow(
        '查询用户失败: 用户不存在'
      );
    });
  });

  describe('fetchChessList', () => {
    it('should fetch chess list from API', async () => {
      const games = [{ chessid: 'abc123', datetime: '2024-01-01' }];
      vi.mocked(mockNetwork.request).mockResolvedValue({
        data: { result: 0, chesslist: games },
        status: 200,
      } as IResponse<{ result: number; chesslist: Array<{ chessid: string }> }>);

      const result = await provider.fetchChessList('123456');

      expect(result).toEqual(games);
    });

    it('should handle API error', async () => {
      vi.mocked(mockNetwork.request).mockResolvedValue({
        data: { result: 1, resultstr: '权限不足' },
        status: 200,
      } as IResponse<{ result: number; resultstr: string }>);

      await expect(provider.fetchChessList('123456')).rejects.toThrow(
        '权限不足'
      );
    });
  });

  describe('fetchSGF', () => {
    it('should fetch SGF content', async () => {
      vi.mocked(mockNetwork.request).mockResolvedValue({
        data: { result: 0, chess: '(;GM[1]FF[4])' },
        status: 200,
      } as IResponse<{ result: number; chess: string }>);

      const result = await provider.fetchSGF('abc123');

      expect(result).toBe('(;GM[1]FF[4])');
    });

    it('should throw error on failure', async () => {
      vi.mocked(mockNetwork.request).mockResolvedValue({
        data: { result: 1, resultstr: '棋谱不存在' },
        status: 200,
      } as IResponse<{ result: number; resultstr: string }>);

      await expect(provider.fetchSGF('invalid')).rejects.toThrow(
        '下载棋谱失败: 棋谱不存在'
      );
    });
  });

  describe('fetchPublicQipuList', () => {
    it('should parse HTML and extract qipu links', async () => {
      // 新版H5分享链接格式
      const html = `
        <tr>
          <h4 class="qipu-title">
            <a href="https://h5.foxwq.com/yehunewshare/?chessid=abc123&title=测试">第1局</a>
          </h4>
          <td class="qipu-time text-right">2024-01-01 12:00</td>
        </tr>
      `;
      vi.mocked(mockNetwork.request).mockResolvedValue({
        data: html,
        status: 200,
      } as IResponse<string>);

      const result = await provider.fetchPublicQipuList('2024-01-01');

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('第1局');
      expect(result[0].url).toBe('https://h5.foxwq.com/yehunewshare/?chessid=abc123&title=测试');
      expect(result[0].date).toBe('2024-01-01');
    });

    it('should filter by date', async () => {
      const html = `
        <tr>
          <h4 class="qipu-title"><a href="https://h5.foxwq.com/yehunewshare/?chessid=123">第1局</a></h4>
          <td class="qipu-time">2024-01-01 12:00</td>
        </tr>
        <tr>
          <h4 class="qipu-title"><a href="https://h5.foxwq.com/yehunewshare/?chessid=124">第2局</a></h4>
          <td class="qipu-time">2024-01-02 12:00</td>
        </tr>
      `;
      vi.mocked(mockNetwork.request).mockResolvedValue({
        data: html,
        status: 200,
      } as IResponse<string>);

      const result = await provider.fetchPublicQipuList('2024-01-01');

      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('2024-01-01');
    });
  });

  describe('fetchPublicQipuSgf', () => {
    it('should extract SGF from URL with chessid', async () => {
      vi.mocked(mockNetwork.request).mockResolvedValue({
        data: { result: 0, chess: '(;GM[1]FF[4]SZ[19]GN[第1局]DT[2024-01-01])' },
        status: 200,
      } as IResponse<{ result: number; chess: string }>);

      const result = await provider.fetchPublicQipuSgf(
        'https://h5.foxwq.com/yehunewshare/?chessid=test123'
      );

      expect(result.sgf).toBe('(;GM[1]FF[4]SZ[19]GN[第1局]DT[2024-01-01])');
      expect(result.title).toBe('第1局');
      expect(result.date).toBe('2024-01-01');
    });

    it('should throw error if chessid not in URL', async () => {
      await expect(
        provider.fetchPublicQipuSgf('http://test.com')
      ).rejects.toThrow('无法从URL中提取棋谱ID');
    });
  });
});
