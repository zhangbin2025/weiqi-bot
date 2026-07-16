/**
 * @fileoverview EventService 单元测试（赛事服务）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventService } from '../EventService';
import type { NetworkManager } from '../../../infrastructure/network/core/NetworkManager';
import type { ICacheStorage } from '../../../infrastructure/storage/interfaces/ICacheStorage';
import type { IConfigProvider } from '../../../infrastructure/config/interfaces/IConfigProvider';

describe('EventService', () => {
  let service: EventService;
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
      has: vi.fn(),
      keys: vi.fn().mockResolvedValue([]),
      clear: vi.fn(),
      size: vi.fn().mockResolvedValue(0),
    } as unknown as ICacheStorage;

    mockConfig = {
      getModuleConfig: vi.fn().mockResolvedValue({
        proxyUrl: 'https://api.weiqi.lol',
        eventsBaseUrl: 'https://data-center.yunbisai.com/api/lswl-events',
        groupsBaseUrl: 'https://open.yunbisai.com/api/event/feel/list',
        againstPlanBaseUrl: 'https://api.yunbisai.com/request/Group/Againstplan',
        timeout: 30000,
      }),
    } as unknown as IConfigProvider;

    service = new EventService(mockNetwork, mockCache, mockConfig);
  });

  describe('getEvents', () => {
    it('应返回比赛列表', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: {
          datArr: {
            rows: [
              { event_id: 1, title: '测试比赛', city_name: '广州', max_time: '2024-01-01', play_num: 100 },
            ],
            TotalPage: 1,
          },
        },
        status: 200,
      });

      const result = await service.getEvents({ area: '广东省', month: 1 });

      expect(result.events.length).toBe(1);
      expect(result.events[0].title).toBe('测试比赛');
      expect(result.total).toBe(1);
    });

    it('应支持关键词过滤', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: {
          datArr: {
            rows: [
              { event_id: 1, title: '围棋比赛', city_name: '广州', play_num: 50 },
              { event_id: 2, title: '象棋比赛', city_name: '北京', play_num: 30 },
            ],
            TotalPage: 1,
          },
        },
        status: 200,
      });

      const result = await service.getEvents({ keyword: '围棋' });

      expect(result.events.length).toBe(1);
      expect(result.events[0].title).toBe('围棋比赛');
    });
  });

  describe('getGroups', () => {
    it('应通过HTML解析返回分组列表', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: '<a data-groupid="101" data-groupname="公开组">',
        status: 200,
        responseType: 'text',
      });

      const result = await service.getGroups(12345);

      expect(result.groups.length).toBe(1);
      expect(result.groups[0].name).toBe('公开组');
      expect(result.source).toBe('html');
    });
  });

  describe('getGroupPlayers', () => {
    it('应返回空列表（API不可用）', async () => {
      const result = await service.getGroupPlayers(12345, 101);
      expect(result.players.length).toBe(0);
      expect(result.total).toBe(0);
    });
  });

  describe('getAgainstPlan', () => {
    it('应返回对阵数据', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: {
          error: 0,
          datArr: {
            rows: [
              { p1id: 1, p1: '黑方', p1_score: 2, p2id: 2, p2: '白方', p2_score: 0 },
            ],
            total_bout: 5,
          },
        },
        status: 200,
      });

      const result = await service.getAgainstPlan(101, 1);

      expect(result.success).toBe(true);
      expect(result.rows.length).toBe(1);
      expect(result.totalBout).toBe(5);
      expect(result.rows[0].p1Name).toBe('黑方');
    });

    it('API 错误时返回失败状态', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { error: 1 },
        status: 200,
      });

      const result = await service.getAgainstPlan(101, 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('API error');
    });
  });

  describe('getAllRounds', () => {
    it('应返回缓存结果（如果存在）', async () => {
      const cached = {
        matches: [{ bout: 1, p1Id: 1, p1Name: '黑', p1Score: 2, p2Id: 2, p2Name: '白', p2Score: 0 }],
        totalRounds: 5,
        completedRounds: 1,
      };
      (mockCache.get as ReturnType<typeof vi.fn>).mockResolvedValue(cached);

      const result = await service.getAllRounds(101);

      expect(result).toEqual(cached);
      expect(mockNetwork.request).not.toHaveBeenCalled();
    });

    it('应获取所有轮次数据', async () => {
      (mockCache.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockNetwork.request as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          data: {
            error: 0,
            datArr: {
              rows: [{ p1id: 1, p1: '黑', p1_score: 2, p2id: 2, p2: '白', p2_score: 0 }],
              total_bout: 2,
            },
          },
          status: 200,
        })
        .mockResolvedValueOnce({
          data: {
            error: 0,
            datArr: {
              rows: [{ p1id: 1, p1: '黑', p1_score: 0, p2id: 3, p2: '白', p2_score: 2 }],
              total_bout: 2,
            },
          },
          status: 200,
        });

      const progress: Array<{ msg: string; pct: number }> = [];
      const result = await service.getAllRounds(101, (msg, pct) => {
        progress.push({ msg, pct });
      });

      expect(result.matches.length).toBe(2);
      expect(result.totalRounds).toBe(2);
      expect(progress.length).toBeGreaterThan(0);
      expect(mockCache.set).toHaveBeenCalled();
    });

    it('无对阵数据时返回空结果', async () => {
      (mockCache.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { error: 1 },
        status: 200,
      });

      const result = await service.getAllRounds(101);

      expect(result.matches.length).toBe(0);
      expect(result.totalRounds).toBe(0);
    });
  });

  describe('getAllRoundsFromCache', () => {
    it('应返回缓存数据', async () => {
      const cached = { matches: [], totalRounds: 0, completedRounds: 0 };
      (mockCache.get as ReturnType<typeof vi.fn>).mockResolvedValue(cached);

      const result = await service.getAllRoundsFromCache(101);

      expect(result).toEqual(cached);
      expect(mockCache.get).toHaveBeenCalledWith('event:rounds:101');
    });

    it('无缓存时返回 null', async () => {
      (mockCache.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await service.getAllRoundsFromCache(101);

      expect(result).toBeNull();
    });
  });

  describe('clearGroupCache', () => {
    it('应清除缓存', async () => {
      await service.clearGroupCache(101);

      expect(mockCache.delete).toHaveBeenCalledWith('event:rounds:101');
    });
  });
});
