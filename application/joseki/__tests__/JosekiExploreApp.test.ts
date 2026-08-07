import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JosekiExploreApp } from '../JosekiExploreApp';
import type { IJosekiExploreService, IExploreResult } from '../../../services/joseki/explore/IJosekiExploreService';
import type { IFavoriteService, IFavoriteItem } from '../../../services/favorite/IFavoriteService';
import type { IJosekiLoader } from '../../../services/joseki/IJosekiLoader';
import { ThumbnailService } from '../../../services/thumbnail/ThumbnailService';
/** 创建 mock JosekiExploreService */
function createMockJosekiExploreService(): IJosekiExploreService {
  return {
    explore: vi.fn().mockImplementation(async (path: string[], _onProgress?: any) => {
      return {
        path: ['Q16', 'D4'],
        node: { children: new Map(), winrate: { delta: 0.02, stddev: 0.05, samples: 100 } },
        candidates: [
          { coord: 'R16', stats: { winrateDelta: 0.03, frequency: 10, probability: 0.3, heat: 10 } },
          { coord: 'C16', stats: { winrateDelta: 0.01, frequency: 5, probability: 0.15, heat: 5 } },
        ],
        stats: { movesCount: 50, winrateDelta: 0.02, frequency: 100, probability: 0.5, heat: 50 },
      } as IExploreResult;
    }),
  } as unknown as IJosekiExploreService;
}
/** 创建 mock FavoriteService */
function createMockFavoriteService(): IFavoriteService {
  const items: IFavoriteItem[] = [];
  let idCounter = 0;
  return {
    addFavorite: vi.fn().mockImplementation(async (category: string, key: string, _data?: Record<string, unknown>, note?: string) => {
      const id = `fav:${++idCounter}`;
      items.push({ id, category, key, createdAt: Date.now(), note });
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
        const idx = items.findIndex(i => i.category === category);
        while (idx >= 0) {
          items.splice(idx, 1);
        }
      } else {
        items.length = 0;
      }
    }),
  } as unknown as IFavoriteService;
}
/** 创建 mock JosekiLoader */
function createMockJosekiLoader(): IJosekiLoader {
  return {
    loadTrie: vi.fn().mockImplementation(async (onProgress?: any) => {
      onProgress?.(0, '开始');
      onProgress?.(100, '完成');
      return { root: {} };
    }),
    loadMeta: vi.fn().mockResolvedValue({ total: 100, version: '1.0' }),
    clearCache: vi.fn(),
  } as unknown as IJosekiLoader;
}
/** 创建 mock ThumbnailService */
function createMockThumbnailService(): ThumbnailService {
  return {
    buildBoardState: vi.fn().mockReturnValue({ board: [], currentPlayer: 'black' }),
  } as unknown as ThumbnailService;
}
describe('JosekiExploreApp', () => {
  describe('构造函数', () => {
    it('应该接受可选参数', () => {
      const app = new JosekiExploreApp();
      expect(app).toBeDefined();
    });
    it('应该接受全部参数', () => {
      const exploreService = createMockJosekiExploreService();
      const loader = createMockJosekiLoader();
      const favoriteService = createMockFavoriteService();
      const thumbnailService = createMockThumbnailService();
      const app = new JosekiExploreApp(exploreService, loader, favoriteService, thumbnailService);
      expect(app).toBeDefined();
    });
  });
  describe('initialize', () => {
    it('应该加载定式库并报告进度', async () => {
      const loader = createMockJosekiLoader();
      const app = new JosekiExploreApp(undefined, loader);
      const progressCallback = vi.fn();
      await app.initialize(progressCallback);
      expect(loader.loadTrie).toHaveBeenCalled();
      expect(progressCallback).toHaveBeenCalled();
    });
    it('无 JosekiLoader 时应该抛出错误', async () => {
      const app = new JosekiExploreApp();
      await expect(app.initialize()).rejects.toThrow('JosekiLoader not available');
    });
    it('重复初始化应直接返回', async () => {
      const loader = createMockJosekiLoader();
      const app = new JosekiExploreApp(undefined, loader);
      const progressCallback = vi.fn();
      await app.initialize(progressCallback);
      await app.initialize(progressCallback);
      expect(loader.loadTrie).toHaveBeenCalledTimes(1);
      expect(progressCallback).toHaveBeenLastCalledWith(100, '已加载');
    });
  });
  describe('explore', () => {
    it('应该探索定式路径', async () => {
      const exploreService = createMockJosekiExploreService();
      const app = new JosekiExploreApp(exploreService);
      // 不需要显式初始化，explore 会自动处理
      const result = await app.explore(['Q16', 'D4']);
      expect(result.path).toEqual(['Q16', 'D4']);
      expect(result.stats.moves).toBe(50);
      expect(result.stats.winrate?.delta).toBe(0.02);
      expect(result.candidates).toHaveLength(2);
    });
    it('应该自动初始化定式库', async () => {
      const loader = createMockJosekiLoader();
      const exploreService = createMockJosekiExploreService();
      const app = new JosekiExploreApp(exploreService, loader);
      const result = await app.explore(['Q16']);
      // explore 会调用 JosekiExploreService.explore
      expect(exploreService.explore).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
    it('应该按热度降序排列候选着法', async () => {
      const exploreService = createMockJosekiExploreService();
      const app = new JosekiExploreApp(exploreService);
      const result = await app.explore(['Q16']);
      expect(result.candidates[0].heat).toBeGreaterThanOrEqual(result.candidates[1].heat);
    });
    it('应该正确计算黑/白着法颜色', async () => {
      const exploreService = createMockJosekiExploreService();
      const app = new JosekiExploreApp(exploreService);
      // path 长度为偶数时，下一手是黑
      const result = await app.explore(['Q16', 'D4']);
      expect(result.candidates[0].color).toBe('black');
    });
    it('无 JosekiExploreService 时应该抛出错误', async () => {
      const app = new JosekiExploreApp();
      await expect(app.explore(['Q16'])).rejects.toThrow('JosekiExploreService not available');
    });
  });
  describe('addFavorite', () => {
    it('应该收藏定式', async () => {
      const favoriteService = createMockFavoriteService();
      const app = new JosekiExploreApp(undefined, undefined, favoriteService);
      const id = await app.addFavorite(['Q16', 'D4'], '小目定式');
      expect(id).toMatch(/^fav:/);
      expect(favoriteService.addFavorite).toHaveBeenCalledWith('joseki', '["Q16","D4"]', undefined, '小目定式');
    });
    it('无 FavoriteService 时应该抛出错误', async () => {
      const app = new JosekiExploreApp();
      await expect(app.addFavorite(['Q16'])).rejects.toThrow('FavoriteService not available');
    });
  });
  describe('queryFavorites', () => {
    it('应该查询收藏列表', async () => {
      const favoriteService = createMockFavoriteService();
      await favoriteService.addFavorite('joseki', '["Q16"]', undefined, 'test note');
      const app = new JosekiExploreApp(undefined, undefined, favoriteService);
      const result = await app.queryFavorites();
      expect(result).toHaveLength(1);
      expect(result[0].path).toEqual(['Q16']);
      expect(result[0].note).toBe('test note');
    });
    it('应该按关键词过滤', async () => {
      const favoriteService = createMockFavoriteService();
      await favoriteService.addFavorite('joseki', '["Q16"]', undefined, 'star point');
      await favoriteService.addFavorite('joseki', '["D4"]', undefined, '3-3 point');
      const app = new JosekiExploreApp(undefined, undefined, favoriteService);
      const result = await app.queryFavorites({ keyword: 'star' });
      expect(result).toHaveLength(1);
      expect(result[0].note).toBe('star point');
    });
    it('应该支持分页', async () => {
      const favoriteService = createMockFavoriteService();
      await favoriteService.addFavorite('joseki', '["Q16"]');
      await favoriteService.addFavorite('joseki', '["D4"]');
      await favoriteService.addFavorite('joseki', '["C4"]');
      const app = new JosekiExploreApp(undefined, undefined, favoriteService);
      const result = await app.queryFavorites({ limit: 2, offset: 1 });
      expect(result).toHaveLength(2);
    });
    it('无 FavoriteService 时应该返回空数组', async () => {
      const app = new JosekiExploreApp();
      const result = await app.queryFavorites();
      expect(result).toEqual([]);
    });
  });
  describe('removeFavorite', () => {
    it('应该删除收藏', async () => {
      const favoriteService = createMockFavoriteService();
      const app = new JosekiExploreApp(undefined, undefined, favoriteService);
      await app.removeFavorite('fav:1');
      expect(favoriteService.removeFavorite).toHaveBeenCalledWith('fav:1');
    });
    it('无 FavoriteService 时应该抛出错误', async () => {
      const app = new JosekiExploreApp();
      await expect(app.removeFavorite('fav:1')).rejects.toThrow('FavoriteService not available');
    });
  });
  describe('exportFavorites', () => {
    it('应该导出收藏为 JSON', async () => {
      const favoriteService = createMockFavoriteService();
      await favoriteService.addFavorite('joseki', '["Q16"]', undefined, 'test');
      const app = new JosekiExploreApp(undefined, undefined, favoriteService);
      const json = await app.exportFavorites();
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].path).toEqual(['Q16']);
    });
    it('无 FavoriteService 时应该返回空数组 JSON', async () => {
      const app = new JosekiExploreApp();
      const json = await app.exportFavorites();
      expect(json).toBe('[]');
    });
  });
  describe('importFavorites', () => {
    it('应该导入收藏', async () => {
      const favoriteService = createMockFavoriteService();
      const app = new JosekiExploreApp(undefined, undefined, favoriteService);
      const json = JSON.stringify([
        { path: ['Q16'], note: 'note1' },
        { path: ['D4'], note: 'note2' },
      ]);
      const count = await app.importFavorites(json);
      expect(count).toBe(2);
      expect(favoriteService.addFavorite).toHaveBeenCalledTimes(2);
    });
    it('无 FavoriteService 时应该抛出错误', async () => {
      const app = new JosekiExploreApp();
      await expect(app.importFavorites('[]')).rejects.toThrow('FavoriteService not available');
    });
  });
  describe('clearFavorites', () => {
    it('应该清空收藏', async () => {
      const favoriteService = createMockFavoriteService();
      const app = new JosekiExploreApp(undefined, undefined, favoriteService);
      await app.clearFavorites();
      expect(favoriteService.clear).toHaveBeenCalledWith('joseki');
    });
    it('无 FavoriteService 时应该抛出错误', async () => {
      const app = new JosekiExploreApp();
      await expect(app.clearFavorites()).rejects.toThrow('FavoriteService not available');
    });
  });
  describe('buildBoardState', () => {
    it('应该构建棋盘状态', () => {
      const thumbnailService = createMockThumbnailService();
      const app = new JosekiExploreApp(undefined, undefined, undefined, thumbnailService);
      const result = app.buildBoardState([{ coord: 'Q16', color: 'black' }]);
      expect(thumbnailService.buildBoardState).toHaveBeenCalledWith([{ coord: 'Q16', color: 'black' }]);
    });
    it('无 ThumbnailService 时应该创建默认实例', () => {
      const app = new JosekiExploreApp();
      const result = app.buildBoardState([]);
      expect(result).toBeDefined();
    });
  });
  describe('getFavoriteStats', () => {
    it('应该获取收藏统计', async () => {
      const favoriteService = createMockFavoriteService();
      await favoriteService.addFavorite('joseki', '["Q16"]');
      await favoriteService.addFavorite('joseki', '["D4"]');
      const app = new JosekiExploreApp(undefined, undefined, favoriteService);
      const stats = await app.getFavoriteStats();
      expect(stats.total).toBe(2);
    });
    it('无 FavoriteService 时应该返回零统计', async () => {
      const app = new JosekiExploreApp();
      const stats = await app.getFavoriteStats();
      expect(stats).toEqual({ total: 0 });
    });
  });
});