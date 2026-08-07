import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpponentAnalyzer } from '../OpponentAnalyzer';
import type { IGameService, GameServiceResult } from '../../../services/game';
import type { IJosekiDiscoverService, IDiscoverResult } from '../../../services/joseki/discover/IJosekiDiscoverService';
import type { IActivityLogService, ActivityEntry, ActivityStats } from '../../../services/activity';
/** 创建 mock GameService */
function createMockGameService(): IGameService {
  return {
    fetch: vi.fn().mockResolvedValue({
      success: true,
      archiveId: 'arch:1',
      sgfContent: '(;GM[1]SZ[19])',
      source: 'foxwq',
      url: 'https://foxwq.com/game/1',
      metadata: { gameId: 'chess1', blackName: 'Black', whiteName: 'White', date: '2024-01-01', result: 'B+2.5' },
      fromCache: false,
    } as GameServiceResult),
    fetchMany: vi.fn().mockResolvedValue([]),
    canHandle: vi.fn().mockReturnValue(true),
    listPlayerGames: vi.fn().mockResolvedValue(['chess1', 'chess2', 'chess3']),
    listPublicGames: vi.fn().mockResolvedValue([]),
    fetchByChessIds: vi.fn().mockResolvedValue([
      {
        success: true,
        archiveId: 'arch:1',
        sgfContent: '(;GM[1]SZ[19];B[pd];W[dp])',
        source: 'foxwq',
        url: '',
        metadata: { gameId: 'chess1', blackName: 'PlayerA', whiteName: 'OpponentX', date: '2024-01-01', result: 'B+2.5' },
        fromCache: false,
      },
      {
        success: true,
        archiveId: 'arch:2',
        sgfContent: '(;GM[1]SZ[19];B[dd];W[pp])',
        source: 'foxwq',
        url: '',
        metadata: { gameId: 'chess2', blackName: 'OpponentX', whiteName: 'PlayerB', date: '2024-01-02', result: 'W+1.5' },
        fromCache: false,
      },
      {
        success: false,
        error: 'Network error',
        archiveId: '',
        sgfContent: null,
        source: 'foxwq',
        url: '',
        metadata: { gameId: 'chess3' },
        fromCache: false,
      },
    ] as GameServiceResult[]),
    getByArchiveId: vi.fn().mockResolvedValue('(;GM[1]SZ[19];B[pd];W[dp])'),
    getSupportedProviders: vi.fn().mockReturnValue(['foxwq', 'ogs']),
  } as unknown as IGameService;
}
/** 创建 mock JosekiDiscoverService */
function createMockJosekiDiscoverService(): IJosekiDiscoverService {
  return {
    discoverGames: vi.fn().mockResolvedValue({
      patterns: [
        { prefix: 'Q16-D4', frequency: 10, winrateDelta: 0.05 },
        { prefix: 'D4-Q16', frequency: 8, winrateDelta: -0.02 },
      ],
      total: 2,
    } as IDiscoverResult),
  } as unknown as IJosekiDiscoverService;
}
/** 创建 mock ActivityLogService */
function createMockActivityLogService(): IActivityLogService {
  const entries: ActivityEntry[] = [];
  return {
    record: vi.fn().mockImplementation(async (type: string, title: string, data: Record<string, unknown>, tags?: string[]) => {
      const id = `act:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      entries.push({ id, type, title, data, tags, createdAt: Date.now() });
      return id;
    }),
    query: vi.fn().mockResolvedValue(entries),
    getById: vi.fn().mockImplementation(async (id: string) => entries.find(e => e.id === id) ?? null),
    stats: vi.fn().mockResolvedValue({ total: 10, today: 2, thisWeek: 5, thisMonth: 8, byType: {} } as ActivityStats),
    count: vi.fn().mockResolvedValue(5),
    clear: vi.fn(),
    initialize: vi.fn(),
  } as unknown as IActivityLogService;
}
describe('OpponentAnalyzer', () => {
  describe('构造函数', () => {
    it('应该接受必要参数', () => {
      const gameService = createMockGameService();
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const analyzer = new OpponentAnalyzer(gameService, josekiDiscoverService);
      expect(analyzer).toBeDefined();
    });
    it('应该接受可选 ActivityLogService', () => {
      const gameService = createMockGameService();
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const activityLogService = createMockActivityLogService();
      const analyzer = new OpponentAnalyzer(gameService, josekiDiscoverService, activityLogService);
      expect(analyzer).toBeDefined();
    });
  });
  describe('analyze', () => {
    it('应该完成对手分析', async () => {
      const gameService = createMockGameService();
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const activityLogService = createMockActivityLogService();
      const analyzer = new OpponentAnalyzer(gameService, josekiDiscoverService, activityLogService);
      const result = await analyzer.analyze('foxwq123');
      expect(result.foxwqId).toBe('foxwq123');
      expect(result.games).toHaveLength(2); // 1 failed, 2 succeeded
      expect(result.joseki.count).toBe(2);
      expect(result.joseki.patterns).toHaveLength(2);
      expect(result.analyzedAt).toBeGreaterThan(0);
    });
    it('应该正确构造 game 信息', async () => {
      const gameService = createMockGameService();
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const analyzer = new OpponentAnalyzer(gameService, josekiDiscoverService);
      const result = await analyzer.analyze('foxwq123');
      expect(result.games[0].chessid).toBe('chess1');
      expect(result.games[0].archiveId).toBe('arch:1');
      expect(result.games[0].black).toBe('PlayerA');
      expect(result.games[0].white).toBe('OpponentX');
      expect(result.games[0].date).toBe('2024-01-01');
      expect(result.games[0].result).toBe('B+2.5');
      expect(result.games[0].sgf).toBe('(;GM[1]SZ[19];B[pd];W[dp])');
    });
    it('应该正确构造定式分析结果', async () => {
      const gameService = createMockGameService();
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const analyzer = new OpponentAnalyzer(gameService, josekiDiscoverService);
      const result = await analyzer.analyze('foxwq123');
      expect(result.joseki.patterns[0]).toEqual({
        prefix: 'Q16-D4',
        frequency: 10,
        winrateDelta: 0.05,
      });
      expect(result.joseki.patterns[1]).toEqual({
        prefix: 'D4-Q16',
        frequency: 8,
        winrateDelta: -0.02,
      });
    });
    it('无 winrateDelta 时不应该包含该字段', async () => {
      const gameService = createMockGameService();
      const josekiDiscoverService = createMockJosekiDiscoverService();
      (josekiDiscoverService.discoverGames as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        patterns: [
          { prefix: 'Q16', frequency: 5 },
        ],
        total: 1,
      });
      const analyzer = new OpponentAnalyzer(gameService, josekiDiscoverService);
      const result = await analyzer.analyze('foxwq123');
      expect(result.joseki.patterns[0]).not.toHaveProperty('winrateDelta');
    });
    it('应该使用默认 maxGames=10', async () => {
      const gameService = createMockGameService();
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const analyzer = new OpponentAnalyzer(gameService, josekiDiscoverService);
      await analyzer.analyze('foxwq123');
      expect(gameService.listPlayerGames).toHaveBeenCalledWith('foxwq123', 10);
    });
    it('应该使用自定义 maxGames', async () => {
      const gameService = createMockGameService();
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const analyzer = new OpponentAnalyzer(gameService, josekiDiscoverService);
      await analyzer.analyze('foxwq123', { maxGames: 5 });
      expect(gameService.listPlayerGames).toHaveBeenCalledWith('foxwq123', 5);
    });
    it('应该记录活动日志', async () => {
      const gameService = createMockGameService();
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const activityLogService = createMockActivityLogService();
      const analyzer = new OpponentAnalyzer(gameService, josekiDiscoverService, activityLogService);
      await analyzer.analyze('foxwq123');
      expect(activityLogService.record).toHaveBeenCalledWith(
        'joseki_discover',
        '分析对手：foxwq123',
        expect.objectContaining({
          foxwqId: 'foxwq123',
          gamesCount: 2,
          patternsFound: 2,
          games: expect.arrayContaining([
            expect.objectContaining({ chessid: 'chess1', archiveId: 'arch:1' }),
            expect.objectContaining({ chessid: 'chess2', archiveId: 'arch:2' }),
          ]),
          joseki: expect.objectContaining({ count: 2 }),
        }),
        ['foxwq123', '对手分析'],
      );
    });
    it('无 ActivityLogService 时不应该报错', async () => {
      const gameService = createMockGameService();
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const analyzer = new OpponentAnalyzer(gameService, josekiDiscoverService);
      const result = await analyzer.analyze('foxwq123');
      expect(result).toBeDefined();
    });
    it('全部下载失败时应该跳过定式分析', async () => {
      const gameService = createMockGameService();
      (gameService.fetchByChessIds as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { success: false, error: 'fail', archiveId: '', sgfContent: null, source: 'foxwq', url: '', metadata: { gameId: 'chess1' }, fromCache: false },
      ] as GameServiceResult[]);
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const analyzer = new OpponentAnalyzer(gameService, josekiDiscoverService);
      const result = await analyzer.analyze('foxwq123');
      expect(result.joseki.count).toBe(0);
      expect(result.joseki.patterns).toHaveLength(0);
      expect(josekiDiscoverService.discoverGames).not.toHaveBeenCalled();
    });
    it('应该在分析过程中调用进度回调', async () => {
      const gameService = createMockGameService();
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const onProgress = vi.fn();
      const analyzer = new OpponentAnalyzer(gameService, josekiDiscoverService);
      await analyzer.analyze('foxwq123', { maxGames: 5, onProgress });
      expect(onProgress).toHaveBeenCalled();
      // 检查第一个调用是开始分析
      expect(onProgress.mock.calls[0][1]).toBe('开始分析');
      // 检查最后一个调用是完成
      const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1];
      expect(lastCall[1]).toContain('完成');
    });
  });
  describe('queryHistory', () => {
    it('应该查询对手分析历史', async () => {
      const gameService = createMockGameService();
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const activityLogService = createMockActivityLogService();
      const analyzer = new OpponentAnalyzer(gameService, josekiDiscoverService, activityLogService);
      await analyzer.queryHistory({ foxwqId: 'foxwq123', limit: 10, offset: 0 });
      expect(activityLogService.query).toHaveBeenCalledWith({
        type: 'joseki_discover',
        keyword: 'foxwq123',
        limit: 10,
        offset: 0,
      });
    });
    it('应该使用默认参数', async () => {
      const gameService = createMockGameService();
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const activityLogService = createMockActivityLogService();
      const analyzer = new OpponentAnalyzer(gameService, josekiDiscoverService, activityLogService);
      await analyzer.queryHistory();
      expect(activityLogService.query).toHaveBeenCalledWith({
        type: 'joseki_discover',
        keyword: undefined,
        limit: 20,
        offset: undefined,
      });
    });
    it('无 ActivityLogService 时应该返回空数组', async () => {
      const gameService = createMockGameService();
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const analyzer = new OpponentAnalyzer(gameService, josekiDiscoverService);
      const result = await analyzer.queryHistory();
      expect(result).toEqual([]);
    });
    it('应该返回完整的游戏和定式数据', async () => {
      const gameService = createMockGameService();
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const activityLogService = createMockActivityLogService();
      // 先记录一条活动
      await activityLogService.record('joseki_discover', '分析对手：testfox', {
        foxwqId: 'testfox',
        gamesCount: 2,
        patternsFound: 3,
        games: [
          { chessid: 'chess1', archiveId: 'arch:1', black: 'B1', white: 'W1', date: '2024-01-01', result: 'B+R' },
          { chessid: 'chess2', archiveId: 'arch:2', black: 'B2', white: 'W2', date: '2024-01-01', result: 'W+2.5' },
        ],
        joseki: { count: 3, patterns: [{ prefix: 'Q16-D4', frequency: 5 }] },
      }, ['testfox', '对手分析']);
      const analyzer = new OpponentAnalyzer(gameService, josekiDiscoverService, activityLogService);
      const history = await analyzer.queryHistory({ foxwqId: 'testfox' });
      expect(history).toHaveLength(1);
      expect(history[0].foxwqId).toBe('testfox');
      expect(history[0].games).toHaveLength(2);
      expect(history[0].games[0].archiveId).toBe('arch:1');
      expect(history[0].joseki.count).toBe(3);
      expect(history[0].joseki.patterns).toHaveLength(1);
    });
  });
  describe('getHistoryDetail', () => {
    it('应该获取单条历史详情', async () => {
      const gameService = createMockGameService();
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const activityLogService = createMockActivityLogService();
      const analyzer = new OpponentAnalyzer(gameService, josekiDiscoverService, activityLogService);
      await analyzer.getHistoryDetail('act:1');
      expect(activityLogService.getById).toHaveBeenCalledWith('act:1');
    });
    it('无 ActivityLogService 时应该返回 null', async () => {
      const gameService = createMockGameService();
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const analyzer = new OpponentAnalyzer(gameService, josekiDiscoverService);
      const result = await analyzer.getHistoryDetail('act:1');
      expect(result).toBeNull();
    });
  });
});