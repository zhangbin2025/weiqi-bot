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
        eventpartBaseUrl: 'https://api.yunbisai.com/request/Group/Eventpart',
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

    it('应按 TotalPage 拉全所有页，最近一年不被截断（>10页）', async () => {
      const totalPages = 12;
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockImplementation(async (cfg: { url: string }) => {
        const page = Number(new URL(cfg.url).searchParams.get('page'));
        return {
          data: {
            datArr: {
              rows: [{ event_id: page, title: `第${page}页比赛`, city_name: '广州', max_time: '2026-01-01', play_num: 10 }],
              TotalPage: totalPages,
            },
          },
          status: 200,
        };
      });

      const result = await service.getEvents({ month: 12 });

      expect(mockNetwork.request).toHaveBeenCalledTimes(totalPages);
      expect(result.total).toBe(totalPages);
      // 串行逐页，顺序严格递增，维持服务端的时间倒序
      expect(result.events.map(e => e.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      const requestedPages = (mockNetwork.request as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => Number(new URL(c[0].url).searchParams.get('page')),
      );
      expect(requestedPages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      for (const call of (mockNetwork.request as ReturnType<typeof vi.fn>).mock.calls) {
        expect(new URL(call[0].url).searchParams.get('month')).toBe('12');
      }
    });

    it('串行拉取时上报进度，且任一时刻只有一个在途请求', async () => {
      const totalPages = 12;
      let inFlight = 0, maxInFlight = 0;
      const progress: Array<[string, number]> = [];
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockImplementation(async (cfg: { url: string }) => {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        const page = Number(new URL(cfg.url).searchParams.get('page'));
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return {
          data: { datArr: { rows: [{ event_id: page, title: `第${page}页`, play_num: 1 }], TotalPage: totalPages } },
          status: 200,
        };
      });

      await service.getEvents({ month: 12, onProgress: (msg, pct) => progress.push([msg, pct]) });

      expect(maxInFlight).toBe(1);
      expect(progress[0]).toEqual(['正在加载第 1 页...', 0]);
      expect(progress[progress.length - 1]).toEqual([`已加载 ${totalPages}/${totalPages} 页`, 100]);
      expect(progress.length).toBe(totalPages + 1);
    });

    it('关键词过滤应覆盖所有页而非仅前几页', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockImplementation(async (cfg: { url: string }) => {
        const page = Number(new URL(cfg.url).searchParams.get('page'));
        // 只有最旧的第 12 页含关键词，旧实现（截断到 10 页）搜不到
        const title = page === 12 ? '围棋赛' : '象棋赛';
        return {
          data: { datArr: { rows: [{ event_id: page, title, city_name: '广州', play_num: 10 }], TotalPage: 12 } },
          status: 200,
        };
      });

      const result = await service.getEvents({ month: 12, keyword: '围棋' });

      expect(result.events.length).toBe(1);
      expect(result.events[0].title).toBe('围棋赛');
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
    it('应返回参赛名单（姓名 + 团队）', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: {
          error: 0,
          datArr: {
            rows: [
              { participantname: '张三', teamname: '文昌小学', participantid: '10670025', short: '1' },
              { participantname: '李四', teamname: '流塘小学', participantid: '10670026', short: '2' },
            ],
          },
        },
      });

      const result = await service.getGroupPlayers(12345, 101);
      expect(result.players.length).toBe(2);
      expect(result.total).toBe(2);
      expect(result.players[0]?.name).toBe('张三');
      expect(result.players[0]?.team).toBe('文昌小学');
      expect(result.players[0]?.id).toBe(10670025);
      expect(result.players[1]?.team).toBe('流塘小学');
    });

    it('无姓名的数据应被过滤', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: {
          error: 0,
          datArr: {
            rows: [
              { participantname: '张三', teamname: '文昌小学', participantid: '1' },
              { participantname: '', teamname: '', participantid: '2' },
            ],
          },
        },
      });

      const result = await service.getGroupPlayers(12345, 101);
      expect(result.players.length).toBe(1);
    });

    it('请求失败时应返回空列表而非抛错', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
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
