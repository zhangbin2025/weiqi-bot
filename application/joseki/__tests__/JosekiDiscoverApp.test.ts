import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JosekiDiscoverApp } from '../JosekiDiscoverApp';
import type { IGameService, GameServiceResult } from '../../../services/game';
import type { IJosekiDiscoverService, IDiscoverResult } from '../../../services/joseki/discover/IJosekiDiscoverService';
import type { IJosekiLoader } from '../../../services/joseki/IJosekiLoader';
import type { IFavoriteService, IFavoriteItem } from '../../../services/favorite';
import { ThumbnailService } from '../../../services/thumbnail/ThumbnailService';
/** 创建 mock GameService */
function createMockGameService(): IGameService {
  return {
    fetch: vi.fn().mockResolvedValue({
      success: true,
      archiveId: 'arch:1',
      sgfContent: '(;GM[1]SZ[19])',
      source: 'ogs',
      url: 'https://example.com/game/1',
      metadata: { gameId: '1', blackName: 'Black', whiteName: 'White', date: '2024-01-01' },
      fromCache: false,
    } as GameServiceResult),
    fetchMany: vi.fn().mockResolvedValue([
      { success: true, archiveId: 'arch:1', sgfContent: '(;GM[1]SZ[19])', source: 'ogs', url: 'url1', metadata: { gameId: '1', blackName: 'Black', whiteName: 'White', date: '2024-01-01' }, fromCache: false },
      { success: true, archiveId: 'arch:2', sgfContent: '(;GM[1]SZ[19])', source: 'ogs', url: 'url2', metadata: { gameId: '2', blackName: 'Black2', whiteName: 'White2', date: '2024-01-01' }, fromCache: false },
    ] as GameServiceResult[]),
    canHandle: vi.fn().mockReturnValue(true),
    listPlayerGames: vi.fn().mockResolvedValue(['game1', 'game2']),
    listPublicGames: vi.fn().mockResolvedValue(['url1', 'url2', 'url3']),
    fetchByChessIds: vi.fn().mockResolvedValue([]),
    getByArchiveId: vi.fn().mockResolvedValue('(;GM[1]SZ[19];B[pd];W[dp])'),
    getSupportedProviders: vi.fn().mockReturnValue(['ogs', 'foxwq']),
  } as unknown as IGameService;
}
/** 创建 mock JosekiDiscoverService */
function createMockJosekiDiscoverService(): IJosekiDiscoverService {
  return {
    discoverGames: vi.fn().mockResolvedValue({
      patterns: [
        { prefix: 'Q16', frequency: 10, winrateDelta: 0.05 },
        { prefix: 'D4', frequency: 8, winrateDelta: -0.02 },
      ],
      total: 2,
    } as IDiscoverResult),
  } as unknown as IJosekiDiscoverService;
}
/** 创建 mock JosekiLoader */
function createMockJosekiLoader(): IJosekiLoader {
  return {
    loadTrie: vi.fn().mockResolvedValue({ root: {} }),
    loadMeta: vi.fn().mockResolvedValue({ total: 100, version: '1.0' }),
    clearCache: vi.fn(),
  } as unknown as IJosekiLoader;
}
/** 创建 mock FavoriteService */
function createMockFavoriteService(): IFavoriteService {
  const items: IFavoriteItem[] = [];
  let idCounter = 0;
  return {
    addFavorite: vi.fn().mockImplementation(async (category: string, key: string, data?: Record<string, unknown>, note?: string) => {
      const id = `fav:${++idCounter}`;
      items.push({ id, category, key, data: data ?? {}, createdAt: Date.now(), note });
      return id;
    }),
    getFavorites: vi.fn().mockImplementation(async (query?: { category?: string }) => {
      if (query?.category) {
        return items.filter(i => i.category === query.category);
      }
      return [...items];
    }),
    removeFavorite: vi.fn().mockImplementation(async (id: string) => {
      const idx = items.findIndex(i => i.id === id);
      if (idx >= 0) items.splice(idx, 1);
    }),
    isFavorited: vi.fn().mockResolvedValue(false),
    getFavorite: vi.fn().mockResolvedValue(null),
    updateNote: vi.fn(),
    count: vi.fn().mockImplementation(async (category?: string) => {
      if (category) {
        return items.filter(i => i.category === category).length;
      }
      return items.length;
    }),
    clear: vi.fn().mockImplementation(async (category?: string) => {
      if (category) {
        let idx = items.findIndex(i => i.category === category);
        while (idx >= 0) {
          items.splice(idx, 1);
          idx = items.findIndex(i => i.category === category);
        }
      } else {
        items.length = 0;
      }
    }),
  } as unknown as IFavoriteService;
}
/** 创建 mock ThumbnailService */
function createMockThumbnailService(): ThumbnailService {
  return {
    buildBoardState: vi.fn().mockReturnValue({ board: [], currentPlayer: 'black' }),
  } as unknown as ThumbnailService;
}
describe('JosekiDiscoverApp', () => {
  describe('构造函数', () => {
    it('应该接受可选参数', () => {
      const app = new JosekiDiscoverApp();
      expect(app).toBeDefined();
    });
    it('应该接受全部参数', () => {
      const gameService = createMockGameService();
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const josekiLoader = createMockJosekiLoader();
      const favoriteService = createMockFavoriteService();
      const thumbnailService = createMockThumbnailService();
      const app = new JosekiDiscoverApp(
        gameService,
        josekiDiscoverService,
        josekiLoader,
        favoriteService,
        thumbnailService,
      );
      expect(app).toBeDefined();
    });
  });
  describe('discoverFromOnline', () => {
    it('应该从线上棋谱发现定式', async () => {
      const gameService = createMockGameService();
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const favoriteService = createMockFavoriteService();
      const app = new JosekiDiscoverApp(gameService, josekiDiscoverService, undefined, favoriteService);
      const result = await app.discoverFromOnline('ogs', '2024-01-01', 5);
      expect(result.patterns).toHaveLength(2);
      expect(result.gamesCount).toBe(2);
      expect(result.totalPatterns).toBe(2);
      expect(result.favoriteId).toBeDefined();
      expect(gameService.listPublicGames).toHaveBeenCalledWith('2024-01-01', 5);
    });
    it('应该使用默认参数', async () => {
      const gameService = createMockGameService();
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const app = new JosekiDiscoverApp(gameService, josekiDiscoverService);
      await app.discoverFromOnline('ogs');
      expect(gameService.listPublicGames).toHaveBeenCalledWith(undefined, 10);
    });
    it('无 GameService 时应该抛出错误', async () => {
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const app = new JosekiDiscoverApp(undefined, josekiDiscoverService);
      await expect(app.discoverFromOnline('ogs')).rejects.toThrow('GameService not available');
    });
    it('无 JosekiDiscoverService 时应该抛出错误', async () => {
      const gameService = createMockGameService();
      const app = new JosekiDiscoverApp(gameService);
      await expect(app.discoverFromOnline('ogs')).rejects.toThrow('JosekiDiscoverService not available');
    });
    it('应该过滤掉失败的下载结果', async () => {
      const gameService = createMockGameService();
      (gameService.fetchMany as any).mockResolvedValueOnce([
        { success: true, archiveId: 'arch:1', sgfContent: '(;GM[1]SZ[19])', metadata: {} },
        { success: false, error: 'Download failed' },
        { success: true, archiveId: 'arch:2', sgfContent: '(;GM[1]SZ[19])', metadata: {} },
      ]);
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const app = new JosekiDiscoverApp(gameService, josekiDiscoverService);
      const result = await app.discoverFromOnline('ogs');
      expect(result.gamesCount).toBe(2); // 只有 2 个成功的 SGF
    });
  });
  describe('discoverFromSGF', () => {
    it('应该从本地 SGF 内容发现定式', async () => {
      const josekiDiscoverService = createMockJosekiDiscoverService();
      const favoriteService = createMockFavoriteService();
      const app = new JosekiDiscoverApp(undefined, josekiDiscoverService, undefined, favoriteService);
      const sgfContent = '(;GM[1]SZ[19]PB[Black]PW[White]DT[2024-01-01];B[pd];W[dp])';
      const result = await app.discoverFromSGF(sgfContent, '测试棋谱');
      expect(result.patterns).toHaveLength(2);
      expect(result.gamesCount).toBe(1);
      expect(result.totalPatterns).toBe(2);
      expect(result.favoriteId).toBeDefined();
      expect(josekiDiscoverService.discoverGames).toHaveBeenCalledWith([sgfContent]);
    });
    it('无 JosekiDiscoverService 时应该抛出错误', async () => {
      const app = new JosekiDiscoverApp();
      await expect(app.discoverFromSGF('(;GM[1])', 'test')).rejects.toThrow('JosekiDiscoverService not available');
    });
  });
  describe('queryHistory', () => {
    it('应该查询发现历史', async () => {
      const favoriteService = createMockFavoriteService();
      // 预先添加一条历史记录
      await favoriteService.addFavorite('joseki_discover', 'ogs_2024-01-01', {
        label: 'ogs 2024-01-01',
        source: 'ogs',
        gamesCount: 5,
        patternsFound: 10,
        games: [],
        patterns: [],
      }, 'ogs 2024-01-01');
      const app = new JosekiDiscoverApp(undefined, undefined, undefined, favoriteService);
      const result = await app.queryHistory();
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('ogs');
      expect(result[0].gamesCount).toBe(5);
    });
    it('应该使用默认参数', async () => {
      const favoriteService = createMockFavoriteService();
      const app = new JosekiDiscoverApp(undefined, undefined, undefined, favoriteService);
      await app.queryHistory();
      expect(favoriteService.getFavorites).toHaveBeenCalledWith({ category: 'joseki_discover' });
    });
    it('应该返回完整的游戏和定式数据', async () => {
      const favoriteService = createMockFavoriteService();
      const patterns = [
        { prefix: 'Q16', frequency: 10, winrateDelta: 0.05 },
        { prefix: 'D4', frequency: 8, winrateDelta: -0.02 },
      ];
      const games = [
        { archiveId: 'arch:1', black: 'Black', white: 'White', date: '2024-01-01', result: 'B+R' },
      ];
      await favoriteService.addFavorite('joseki_discover', 'test_key', {
        label: '测试发现',
        source: 'local',
        gamesCount: 1,
        patternsFound: 2,
        games,
        patterns,
      }, '测试发现');
      const app = new JosekiDiscoverApp(undefined, undefined, undefined, favoriteService);
      const result = await app.queryHistory();
      expect(result).toHaveLength(1);
      expect(result[0].patterns).toHaveLength(2);
      expect(result[0].games).toHaveLength(1);
      expect(result[0].games[0].black).toBe('Black');
    });
    it('无 FavoriteService 时应该返回空数组', async () => {
      const app = new JosekiDiscoverApp();
      const result = await app.queryHistory();
      expect(result).toEqual([]);
    });
  });
  describe('getHistoryDetail', () => {
    it('应该获取单条历史详情', async () => {
      const favoriteService = createMockFavoriteService();
      const id = await favoriteService.addFavorite('joseki_discover', 'test_key', {
        label: '测试详情',
        source: 'ogs',
        gamesCount: 3,
        patternsFound: 5,
        games: [],
        patterns: [],
      }, '测试详情');
      const app = new JosekiDiscoverApp(undefined, undefined, undefined, favoriteService);
      // getHistoryDetail 使用 key 查找，不是 fav id
      const result = await app.getHistoryDetail('test_key');
      expect(result).not.toBeNull();
      expect(result!.label).toBe('测试详情');
      expect(result!.gamesCount).toBe(3);
    });
    it('不存在的 ID 应该返回 null', async () => {
      const favoriteService = createMockFavoriteService();
      const app = new JosekiDiscoverApp(undefined, undefined, undefined, favoriteService);
      const result = await app.getHistoryDetail('nonexistent');
      expect(result).toBeNull();
    });
  });
  describe('clearHistory', () => {
    it('应该清除发现历史', async () => {
      const favoriteService = createMockFavoriteService();
      await favoriteService.addFavorite('joseki_discover', 'test_key', {
        label: '测试',
        source: 'ogs',
        gamesCount: 1,
        patternsFound: 1,
        games: [],
        patterns: [],
      }, '测试');
      const app = new JosekiDiscoverApp(undefined, undefined, undefined, favoriteService);
      await app.clearHistory();
      expect(favoriteService.clear).toHaveBeenCalledWith('joseki_discover');
    });
  });
  describe('getStats', () => {
    it('应该获取统计信息', async () => {
      const favoriteService = createMockFavoriteService();
      await favoriteService.addFavorite('joseki_discover', 'test1', {
        label: '测试1',
        source: 'ogs',
        gamesCount: 1,
        patternsFound: 1,
        games: [],
        patterns: [{ prefix: 'Q16', frequency: 10 }],
      }, '测试1');
      const app = new JosekiDiscoverApp(undefined, undefined, undefined, favoriteService);
      const result = await app.getStats();
      expect(result.total).toBe(1);
      expect(result.topPatterns).toBeDefined();
    });
    it('无 FavoriteService 时应该返回默认统计', async () => {
      const app = new JosekiDiscoverApp();
      const result = await app.getStats();
      expect(result.total).toBe(0);
      expect(result.today).toBe(0);
      expect(result.topPatterns).toEqual([]);
    });
  });
  describe('buildBoardState', () => {
    it('应该构建棋盘状态', () => {
      const thumbnailService = createMockThumbnailService();
      const app = new JosekiDiscoverApp(undefined, undefined, undefined, undefined, thumbnailService);
      app.buildBoardState([{ coord: 'Q16', color: 'black' }]);
      expect(thumbnailService.buildBoardState).toHaveBeenCalledWith([{ coord: 'Q16', color: 'black' }]);
    });
  });
});
