/**
 * @fileoverview PlayerService 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlayerService } from '../PlayerService';
import type { NetworkManager } from '../../../infrastructure/network/core/NetworkManager';
import type { ICacheStorage } from '../../../infrastructure/storage/interfaces/ICacheStorage';
import type { IConfigProvider } from '../../../infrastructure/config/interfaces/IConfigProvider';

describe('PlayerService', () => {
  let service: PlayerService;
  let mockNetwork: NetworkManager;
  let mockCache: ICacheStorage;
  let mockConfig: IConfigProvider;

  beforeEach(() => {
    mockNetwork = {
      request: vi.fn(),
    } as unknown as NetworkManager;

    mockCache = {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      has: vi.fn().mockResolvedValue(false),
      keys: vi.fn().mockResolvedValue([]),
    } as unknown as ICacheStorage;

    mockConfig = {
      getModuleConfig: vi.fn().mockResolvedValue({
        proxyUrl: 'https://api.weiqi.lol',
        shoutanBaseUrl: 'https://v.dzqzd.com/SpBody.aspx',
        yichafenBaseUrl: 'https://api.weiqi.lol/yichafen',
        timeout: 30000,
      }),
    } as unknown as IConfigProvider;

    service = new PlayerService(mockNetwork, mockCache, mockConfig);
  });

  describe('query', () => {
    it('应返回缓存结果（如果存在）', async () => {
      const cachedResult = {
        name: '柯洁',
        shoutan: { found: true, count: 1, players: [] },
        yichafen: { found: false },
        cachedAt: '2024-01-01T00:00:00Z',
      };
      (mockCache.get as ReturnType<typeof vi.fn>).mockResolvedValue(cachedResult);

      const result = await service.query('柯洁');

      expect(result).toEqual(cachedResult);
      expect(mockNetwork.request).not.toHaveBeenCalled();
    });

    it('应并行查询手谈和易查分', async () => {
      (mockCache.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockNetwork.request as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          data: '<Xs 编号="1" 姓名="柯洁" 等级分="3800"/>',
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { url: '' },
          duration: 100,
          provider: 'mock',
        });

      const result = await service.query('柯洁');

      expect(result.shoutan.found).toBe(true);
      // Web 端无法从本地加载易查分数据（测试环境没有静态资源）
      expect(result.yichafen.found).toBe(false);
      expect(result.yichafen.error).toBe('无法获取棋手数据');
      // 只调用了手谈，易查分在 Web 端不会发起远程请求
      expect(mockNetwork.request).toHaveBeenCalledTimes(1);
    });

    it('一个数据源失败不影响另一个', async () => {
      (mockCache.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockNetwork.request as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('手谈查询失败'));

      const result = await service.query('柯洁');

      expect(result.shoutan.error).toBe('Error: 手谈查询失败');
      // Web 端无法从本地加载易查分数据
      expect(result.yichafen.found).toBe(false);
      expect(result.yichafen.error).toBe('无法获取棋手数据');
    });
  });

  describe('queryShoutan', () => {
    it('应解析手谈 HTML 响应', async () => {
      const html = `<Xs 编号="1" 姓名="柯洁" 地区="北京" 称谓="九段" 等级分="3800" 全国排名="1" 对局次数="100"/>`;
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: html,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { url: '' },
        duration: 100,
        provider: 'mock',
      });

      const result = await service.queryShoutan('柯洁');

      expect(result.found).toBe(true);
      expect(result.count).toBe(1);
      expect(result.players[0].name).toBe('柯洁');
      expect(result.players[0].rating).toBe(3800);
    });
  });

  describe('queryYichafen', () => {
    it('Web端应返回无法获取数据的错误', async () => {
      const result = await service.queryYichafen('柯洁');

      expect(result.found).toBe(false);
      expect(result.error).toBe('无法获取棋手数据');
    });
  });

  describe('getFromCache', () => {
    it('应返回缓存结果', async () => {
      const cached = { name: '柯洁', shoutan: { found: true, count: 0, players: [] }, yichafen: { found: false } };
      (mockCache.get as ReturnType<typeof vi.fn>).mockResolvedValue(cached);

      const result = await service.getFromCache('柯洁');

      expect(result).toEqual(cached);
      expect(mockCache.get).toHaveBeenCalledWith('player:柯洁');
    });
  });
});
