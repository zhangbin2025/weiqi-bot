/**
 * EventQuerier 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventQuerier } from '../EventQuerier';
import type { IEventService, EventListResult, GroupListResult, AgainstPlanResult, AllRoundsResult } from '../../../services/event/types';
import type { IRankingCalculator, RankingOutput, RankingMode, MatchData } from '../../../domain/ranking';
import type { IFavoriteService, IFavoriteItem } from '../../../services/favorite';
// Mock factories
const createMockEventService = (): IEventService => ({
  getEvents: vi.fn(),
  getGroups: vi.fn(),
  getGroupPlayers: vi.fn(),
  getAgainstPlan: vi.fn(),
  getAllRounds: vi.fn(),
  getAllRoundsFromCache: vi.fn(),
  clearGroupCache: vi.fn(),
});
const createMockRankingCalculator = (): IRankingCalculator => ({
  rank: vi.fn(),
});
const createMockFavoriteService = (): IFavoriteService => ({
  addFavorite: vi.fn(),
  getFavorites: vi.fn(),
  removeFavorite: vi.fn(),
  isFavorited: vi.fn(),
  getFavorite: vi.fn(),
  updateNote: vi.fn(),
  count: vi.fn(),
  clear: vi.fn(),
});
// Sample data
const mockEventList: EventListResult = {
  events: [
    { id: 1, title: '广东省围棋赛', city: '广州', date: '2024-01-15', players: 100 },
    { id: 2, title: '北京围棋杯', city: '北京', date: '2024-01-20', players: 80 },
  ],
  total: 2,
};
const mockGroupList: GroupListResult = {
  groups: [
    { id: 100, name: '公开组', players: 50 },
    { id: 101, name: '业余组', players: 30 },
  ],
  total: 2,
  source: 'api',
};
const mockAgainstPlan: AgainstPlanResult = {
  rows: [
    { bout: 1, p1Id: 1, p1Name: '张三', p1Score: 2, p2Id: 2, p2Name: '李四', p2Score: 0 },
  ],
  totalBout: 5,
  success: true,
};
const mockAllRounds: AllRoundsResult = {
  matches: [
    { bout: 1, p1Id: 1, p1Name: '张三', p1Score: 2, p2Id: 2, p2Name: '李四', p2Score: 0 },
    { bout: 2, p1Id: 3, p1Name: '王五', p1Score: 2, p2Id: 4, p2Name: '赵六', p2Score: 0 },
  ],
  totalRounds: 5,
  completedRounds: 2,
};
/** 合法排名输出：rows 必须覆盖 mockAllRounds.matches 里的全部 4 名选手 */
const mockRankingOutput: RankingOutput = {
  columns: [{ key: 'score', label: '积分' }],
  rows: [
    { id: 1, name: '张三', rank: 1, cells: { score: 2 } },
    { id: 2, name: '李四', rank: 2, cells: { score: 0 } },
    { id: 3, name: '王五', rank: 3, cells: { score: 2 } },
    { id: 4, name: '赵六', rank: 4, cells: { score: 0 } },
  ],
};
describe('EventQuerier', () => {
  let mockEventService: IEventService;
  let mockRankingCalculator: IRankingCalculator;
  let mockFavoriteService: IFavoriteService;
  beforeEach(() => {
    vi.clearAllMocks();
    mockEventService = createMockEventService();
    mockRankingCalculator = createMockRankingCalculator();
    mockFavoriteService = createMockFavoriteService();
  });
  describe('构造函数', () => {
    it('应该允许所有依赖为可选', () => {
      const querier = new EventQuerier();
      expect(querier).toBeDefined();
    });
    it('应该接受部分依赖注入', () => {
      const querier = new EventQuerier(mockEventService);
      expect(querier).toBeDefined();
    });
    it('应该接受完整依赖注入', () => {
      const querier = new EventQuerier(mockEventService, mockRankingCalculator, mockFavoriteService);
      expect(querier).toBeDefined();
    });
  });
  describe('queryEvents', () => {
    it('应该查询比赛列表', async () => {
      vi.mocked(mockEventService.getEvents).mockResolvedValue(mockEventList);
      const querier = new EventQuerier(mockEventService, undefined, mockFavoriteService);
      const result = await querier.queryEvents({ area: '广东省', month: 3 });
      expect(result.events).toHaveLength(2);
      expect(result.total).toBe(2);
    });
    it('应该在没有 FavoriteService 时正常查询', async () => {
      vi.mocked(mockEventService.getEvents).mockResolvedValue(mockEventList);
      const querier = new EventQuerier(mockEventService);
      const result = await querier.queryEvents();
      expect(result).toBeDefined();
    });
  });
  describe('getEventDetail', () => {
    it('应该获取比赛详情', async () => {
      vi.mocked(mockEventService.getGroups).mockResolvedValue(mockGroupList);
      const querier = new EventQuerier(mockEventService);
      const result = await querier.getEventDetail(12345);
      expect(result.eventId).toBe(12345);
      expect(result.groups).toHaveLength(2);
    });
  });
  describe('getGroupRanking', () => {
    it('应该经统一管线计算排名并产出 RankingTable', async () => {
      vi.mocked(mockEventService.getAllRounds).mockResolvedValue(mockAllRounds);
      vi.mocked(mockRankingCalculator.rank).mockReturnValue(mockRankingOutput);
      const querier = new EventQuerier(mockEventService, mockRankingCalculator);
      const result = await querier.getGroupRanking(12345, 100);
      expect(result.rows).toHaveLength(4);
      // 轮次元信息由管线从原始对阵派生（不是照抄 allRounds 里的字段）
      expect(result.totalRounds).toBe(2);
      expect(result.completedRounds).toBe(2);
      // 内置实现收到 { matches }（唯一原始数据源），默认口径 default
      expect(mockRankingCalculator.rank).toHaveBeenCalledWith(
        { matches: mockAllRounds.matches },
        'default',
      );
    });
    it('应该支持指定内置口径', async () => {
      vi.mocked(mockEventService.getAllRounds).mockResolvedValue(mockAllRounds);
      vi.mocked(mockRankingCalculator.rank).mockReturnValue(mockRankingOutput);
      const querier = new EventQuerier(mockEventService, mockRankingCalculator);
      await querier.getGroupRanking(12345, 100, 'simple');
      expect(mockRankingCalculator.rank).toHaveBeenCalledWith(
        { matches: mockAllRounds.matches },
        'simple',
      );
    });
    it('应该支持进度回调', async () => {
      vi.mocked(mockEventService.getAllRounds).mockResolvedValue(mockAllRounds);
      vi.mocked(mockRankingCalculator.rank).mockReturnValue(mockRankingOutput);
      const onProgress = vi.fn();
      const querier = new EventQuerier(mockEventService, mockRankingCalculator);
      await querier.getGroupRanking(12345, 100, undefined, onProgress);
      expect(mockEventService.getAllRounds).toHaveBeenCalledWith(100, onProgress, false);
    });
    it('输出不符合契约时抛错（不静默返回坏表）', async () => {
      vi.mocked(mockEventService.getAllRounds).mockResolvedValue(mockAllRounds);
      vi.mocked(mockRankingCalculator.rank).mockReturnValue({
        columns: [{ key: 'score', label: '积分' }],
        rows: [{ id: 99, name: '伪造', rank: 1, cells: { score: 2 } }],
      });
      const querier = new EventQuerier(mockEventService, mockRankingCalculator);
      await expect(querier.getGroupRanking(12345, 100)).rejects.toThrow();
    });
  });
  describe('getGroupMatchesRaw', () => {
    it('应该返回原始对阵表（插件/页面共用唯一数据源）', async () => {
      vi.mocked(mockEventService.getAllRounds).mockResolvedValue(mockAllRounds);
      const querier = new EventQuerier(mockEventService);
      const matches = await querier.getGroupMatchesRaw(100);
      expect(matches).toEqual(mockAllRounds.matches);
    });
  });
  describe('getGroupMatches', () => {
    it('应该获取对阵表', async () => {
      vi.mocked(mockEventService.getAgainstPlan).mockResolvedValue(mockAgainstPlan);
      const querier = new EventQuerier(mockEventService);
      const result = await querier.getGroupMatches(100, 1);
      expect(result.rows).toHaveLength(1);
      expect(result.totalBout).toBe(5);
    });
    it('应该默认使用第 1 轮', async () => {
      vi.mocked(mockEventService.getAgainstPlan).mockResolvedValue(mockAgainstPlan);
      const querier = new EventQuerier(mockEventService);
      await querier.getGroupMatches(100);
      expect(mockEventService.getAgainstPlan).toHaveBeenCalledWith(100, 1);
    });
  });
  describe('getAllRounds', () => {
    it('应该获取所有轮次对阵', async () => {
      vi.mocked(mockEventService.getAllRounds).mockResolvedValue(mockAllRounds);
      const querier = new EventQuerier(mockEventService);
      const result = await querier.getAllRounds(100);
      expect(result.matches).toHaveLength(2);
      expect(result.totalRounds).toBe(5);
    });
    it('应该支持进度回调', async () => {
      vi.mocked(mockEventService.getAllRounds).mockResolvedValue(mockAllRounds);
      const onProgress = vi.fn();
      const querier = new EventQuerier(mockEventService);
      await querier.getAllRounds(100, onProgress);
      expect(mockEventService.getAllRounds).toHaveBeenCalledWith(100, onProgress, false);
    });
  });
  describe('recordVisited', () => {
    it('应该记录访问到收藏', async () => {
      vi.mocked(mockFavoriteService.addFavorite).mockResolvedValue('fav:1');
      const querier = new EventQuerier(mockEventService, undefined, mockFavoriteService);
      const id = await querier.recordVisited(12345, '广东省围棋赛');
      expect(id).toBe('fav:1');
      expect(mockFavoriteService.addFavorite).toHaveBeenCalledWith(
        'event',
        '12345',
        expect.objectContaining({ title: '广东省围棋赛', visitedAt: expect.any(Number) }),
      );
    });
  });
  describe('queryHistory', () => {
    it('应该在缺少 FavoriteService 时返回空数组', async () => {
      const querier = new EventQuerier();
      const result = await querier.queryHistory();
      expect(result).toEqual([]);
    });
    it('应该查询访问历史', async () => {
      const mockItems: IFavoriteItem[] = [
        {
          id: 'fav:1',
          category: 'event',
          key: '12345',
          data: { title: '广东省围棋赛' },
          createdAt: Date.now(),
        },
      ];
      vi.mocked(mockFavoriteService.getFavorites).mockResolvedValue(mockItems);
      const querier = new EventQuerier(undefined, undefined, mockFavoriteService);
      const result = await querier.queryHistory({ limit: 10 });
      expect(result).toHaveLength(1);
      expect(result[0].eventId).toBe(12345);
      expect(result[0].title).toBe('广东省围棋赛');
      expect(mockFavoriteService.getFavorites).toHaveBeenCalledWith({ category: 'event' });
    });
    it('应该按时间倒序排列', async () => {
      const now = Date.now();
      const mockItems: IFavoriteItem[] = [
        { id: 'fav:1', category: 'event', key: '111', data: { title: '旧比赛' }, createdAt: now - 1000 },
        { id: 'fav:2', category: 'event', key: '222', data: { title: '新比赛' }, createdAt: now },
      ];
      vi.mocked(mockFavoriteService.getFavorites).mockResolvedValue(mockItems);
      const querier = new EventQuerier(undefined, undefined, mockFavoriteService);
      const result = await querier.queryHistory();
      expect(result[0].title).toBe('新比赛');
      expect(result[1].title).toBe('旧比赛');
    });
  });
  describe('clearHistory', () => {
    it('应该清空访问历史', async () => {
      vi.mocked(mockFavoriteService.clear).mockResolvedValue(undefined);
      const querier = new EventQuerier(undefined, undefined, mockFavoriteService);
      await querier.clearHistory();
      expect(mockFavoriteService.clear).toHaveBeenCalledWith('event');
    });
    it('应该在缺少 FavoriteService 时不报错', async () => {
      const querier = new EventQuerier();
      await expect(querier.clearHistory()).resolves.not.toThrow();
    });
  });
  describe('getStats', () => {
    it('应该在缺少 FavoriteService 时返回零值', async () => {
      const querier = new EventQuerier();
      const result = await querier.getStats();
      expect(result).toEqual({ total: 0, today: 0 });
    });
    it('应该返回统计信息', async () => {
      vi.mocked(mockFavoriteService.count).mockResolvedValue(100);
      const querier = new EventQuerier(undefined, undefined, mockFavoriteService);
      const result = await querier.getStats();
      expect(result.total).toBe(100);
      expect(result.today).toBe(0);
    });
  });
});
