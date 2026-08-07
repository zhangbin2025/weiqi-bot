/**
 * PlayerQuerier 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlayerQuerier } from '../PlayerQuerier';
import type { IPlayerService, PlayerQueryResult } from '../../../services/player/types';
import type { IFavoriteService, IFavoriteItem } from '../../../services/favorite/IFavoriteService';
const createMockPlayerService = (): IPlayerService => ({
  query: vi.fn(),
  queryShoutan: vi.fn(),
  queryYichafen: vi.fn(),
  getFromCache: vi.fn(),
});
const createMockFavoriteService = (): IFavoriteService => ({
  addFavorite: vi.fn(),
  getFavorites: vi.fn(),
  getFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  clear: vi.fn(),
  count: vi.fn(),
  initialize: vi.fn(),
});
const mockQueryResult: PlayerQueryResult = {
  name: '柯洁',
  shoutan: {
    found: true,
    count: 1,
    players: [
      { name: '柯洁', region: '中国', title: '九段', rating: 3682, rank: 1, games: 500 },
    ],
  },
  yichafen: {
    found: true,
    players: [{ name: '柯洁', rank: '职业九段' }],
    data: {
      name: '柯洁',
      level: '职业九段',
      rating: 3682,
      totalRank: 1,
      province: '北京',
    },
  },
};
describe('PlayerQuerier', () => {
  let mockPlayerService: IPlayerService;
  let mockFavoriteService: IFavoriteService;
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlayerService = createMockPlayerService();
    mockFavoriteService = createMockFavoriteService();
  });
  describe('构造函数', () => {
    it('应该接受必须依赖 PlayerService', () => {
      const querier = new PlayerQuerier(mockPlayerService);
      expect(querier).toBeDefined();
    });
    it('应该接受完整依赖注入', () => {
      const querier = new PlayerQuerier(mockPlayerService, mockFavoriteService);
      expect(querier).toBeDefined();
    });
    it('应该允许 FavoriteService 为可选', () => {
      const querier = new PlayerQuerier(mockPlayerService, undefined);
      expect(querier).toBeDefined();
    });
  });
  describe('query', () => {
    it('应该调用 PlayerService.query 并返回结果', async () => {
      vi.mocked(mockPlayerService.query).mockResolvedValue(mockQueryResult);
      const querier = new PlayerQuerier(mockPlayerService);
      const result = await querier.query('柯洁');
      expect(result.name).toBe('柯洁');
      expect(result.shoutan.found).toBe(true);
      expect(mockPlayerService.query).toHaveBeenCalledWith('柯洁');
    });
    it('应该在查到棋手时添加收藏', async () => {
      vi.mocked(mockPlayerService.query).mockResolvedValue(mockQueryResult);
      vi.mocked(mockFavoriteService.addFavorite).mockResolvedValue('fav:1');
      const querier = new PlayerQuerier(mockPlayerService, mockFavoriteService);
      const result = await querier.query('柯洁');
      expect(result.bookmarkId).toBe('fav:1');
      expect(mockFavoriteService.addFavorite).toHaveBeenCalledWith(
        'player',
        '柯洁',
        { name: '柯洁', result: mockQueryResult },
      );
    });
    it('应该在缺少 FavoriteService 时不添加收藏', async () => {
      vi.mocked(mockPlayerService.query).mockResolvedValue(mockQueryResult);
      const querier = new PlayerQuerier(mockPlayerService);
      const result = await querier.query('柯洁');
      expect(result.bookmarkId).toBeUndefined();
    });
    it('应该在查不到棋手时不添加收藏', async () => {
      const emptyResult: PlayerQueryResult = {
        name: '不存在',
        shoutan: { found: false, count: 0, players: [] },
        yichafen: { found: false, players: [] },
      };
      vi.mocked(mockPlayerService.query).mockResolvedValue(emptyResult);
      const querier = new PlayerQuerier(mockPlayerService, mockFavoriteService);
      const result = await querier.query('不存在');
      expect(result.shoutan.found).toBe(false);
      expect(result.bookmarkId).toBeUndefined();
      expect(mockFavoriteService.addFavorite).not.toHaveBeenCalled();
    });
  });
  describe('getFavorites', () => {
    it('应该在缺少 FavoriteService 时返回空数组', async () => {
      const querier = new PlayerQuerier(mockPlayerService);
      const result = await querier.getFavorites();
      expect(result).toEqual([]);
    });
    it('应该返回收藏列表', async () => {
      const mockItems: IFavoriteItem[] = [
        {
          id: 'fav:1',
          category: 'player',
          key: '柯洁',
          data: { name: '柯洁', result: mockQueryResult },
          createdAt: Date.now(),
        },
      ];
      vi.mocked(mockFavoriteService.getFavorites).mockResolvedValue(mockItems);
      const querier = new PlayerQuerier(mockPlayerService, mockFavoriteService);
      const result = await querier.getFavorites();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('柯洁');
    });
  });
  describe('clearFavorites', () => {
    it('应该调用 FavoriteService.clear', async () => {
      const querier = new PlayerQuerier(mockPlayerService, mockFavoriteService);
      await querier.clearFavorites();
      expect(mockFavoriteService.clear).toHaveBeenCalledWith('player');
    });
    it('应该在缺少 FavoriteService 时不报错', async () => {
      const querier = new PlayerQuerier(mockPlayerService);
      await expect(querier.clearFavorites()).resolves.toBeUndefined();
    });
  });
});
