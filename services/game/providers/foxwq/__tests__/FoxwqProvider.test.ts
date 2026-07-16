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
        '下载棋谱失败: 无法获取棋谱内容'
      );
    });
  });

  describe('fetchPublicQipuList', () => {
    it('should parse HTML and extract qipu links', async () => {
      const html = `
        <tr>
          <h4>第1局</h4>
          <a href="/qipu/newlist/id/123.html">下载</a>
          2024-01-01
        </tr>
      `;
      vi.mocked(mockNetwork.request).mockResolvedValue({
        data: html,
        status: 200,
      } as IResponse<string>);

      const result = await provider.fetchPublicQipuList('2024-01-01');

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('第1局');
      expect(result[0].url).toBe('https://www.foxwq.com/qipu/newlist/id/123.html');
      expect(result[0].date).toBe('2024-01-01');
    });

    it('should filter by date', async () => {
      const html = `
        <tr><h4>第1局</h4><a href="/qipu/newlist/id/123.html"></a>2024-01-01</tr>
        <tr><h4>第2局</h4><a href="/qipu/newlist/id/124.html"></a>2024-01-02</tr>
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
    it('should extract SGF from HTML', async () => {
      const html = `
        <html>
          <h1>第1局</h1>
          (;GM[1]FF[4]SZ[19])</div>
          2024-01-01
        </html>
      `;
      vi.mocked(mockNetwork.request).mockResolvedValue({
        data: html,
        status: 200,
      } as IResponse<string>);

      const result = await provider.fetchPublicQipuSgf('http://test.com');

      expect(result.sgf).toBe('(;GM[1]FF[4]SZ[19])');
      expect(result.title).toBe('第1局');
      expect(result.date).toBe('2024-01-01');
    });

    it('should throw error if SGF not found', async () => {
      const html = '<html><h1>测试</h1></html>';
      vi.mocked(mockNetwork.request).mockResolvedValue({
        data: html,
        status: 200,
      } as IResponse<string>);

      await expect(
        provider.fetchPublicQipuSgf('http://test.com')
      ).rejects.toThrow('无法提取 SGF 内容');
    });
  });
});