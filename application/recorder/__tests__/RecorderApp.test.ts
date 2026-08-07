/**
 * RecorderApp 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecorderApp } from '../RecorderApp';
import { RecorderHistoryManager } from '../RecorderHistoryManager';
import type { IRecorderService } from '../../../services/recorder/IRecorderService';
import type { IExportService } from '../../../services/export/IExportService';
import type { IGameService, GameServiceResult } from '../../../services/game';
import type { IFavoriteService, IFavoriteItem } from '../../../services/favorite';
import type { IGameState, IMoveResult } from '../../../domain/game';
import type { ExportResult } from '../../../infrastructure/utils/export';
// Mock factories
const createMockRecorderService = (): IRecorderService => ({
  placeStone: vi.fn(),
  pass: vi.fn(),
  undo: vi.fn(),
  newGame: vi.fn(),
  getState: vi.fn(),
  generateSGF: vi.fn(),
  saveDraft: vi.fn(),
  loadDraft: vi.fn(),
  clearDraft: vi.fn(),
  setOnUpdate: vi.fn(),
});
const createMockGameService = (): IGameService => ({
  fetch: vi.fn(),
  fetchMany: vi.fn(),
  canHandle: vi.fn(),
  listPlayerGames: vi.fn(),
  listPublicGames: vi.fn(),
  fetchByChessIds: vi.fn(),
  getSupportedProviders: vi.fn(),
  getByArchiveId: vi.fn(),
});
const createMockFavoriteService = (): IFavoriteService => ({
  addFavorite: vi.fn(),
  getFavorites: vi.fn(),
  removeFavorite: vi.fn(),
  isFavorited: vi.fn(),
  getFavorite: vi.fn(),
  getById: vi.fn(),
  updateNote: vi.fn(),
  count: vi.fn(),
  clear: vi.fn(),
});
const createMockExportService = (): IExportService => ({
  exportSGF: vi.fn(),
  exportHistory: vi.fn(),
  exportJSON: vi.fn(),
});

const createMockLogger = (): ILogger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  withContext: vi.fn(),
  setLevel: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  getConfig: vi.fn(),
  name: 'test-logger',
});

import type { ILogger } from '../../../infrastructure/logger/types';
// Sample mock board
const createMockBoard = () => ({
  size: 19,
  get: vi.fn(() => null),
  set: vi.fn(),
  copy: vi.fn(() => createMockBoard()),
  toArray: vi.fn(() => []),
});
// Sample game state
const createMockGameState = (): IGameState => ({
  board: createMockBoard() as any,
  currentPlayer: 'black',
  moveHistory: [{ color: 'black', coord: { x: 3, y: 3 } }],
  phase: 'playing',
  capturedBlack: 0,
  capturedWhite: 0,
  koPosition: null,
  handicap: 0,
  komi: 7.5,
});
describe('RecorderApp', () => {
  let mockRecorderService: IRecorderService;
  let mockGameService: IGameService;
  let mockFavoriteService: IFavoriteService;
  let mockExportService: IExportService;
  let mockLogger: ILogger;
  let mockHistoryManager: RecorderHistoryManager;
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecorderService = createMockRecorderService();
    mockGameService = createMockGameService();
    mockFavoriteService = createMockFavoriteService();
    mockExportService = createMockExportService();
    // 创建历史管理器
    mockHistoryManager = new RecorderHistoryManager(
      mockGameService,
      mockFavoriteService,
    );
  });
  describe('构造函数', () => {
    it('应该接受完整依赖注入', () => {
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      expect(app).toBeDefined();
    });
    it('应该在构造时设置 onUpdate 回调以自动保存草稿', () => {
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      expect(mockRecorderService.setOnUpdate).toHaveBeenCalled();
    });
    it('应该在 state 变化时自动保存草稿', async () => {
      const mockState = createMockGameState();
      let onUpdateCallback: ((state: IGameState) => void) | null = null;
      vi.mocked(mockRecorderService.setOnUpdate).mockImplementation((cb) => {
        onUpdateCallback = cb;
      });
      vi.mocked(mockRecorderService.saveDraft).mockResolvedValue(undefined);
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      // 模拟 state 变化
      if (onUpdateCallback) {
        onUpdateCallback(mockState);
      }
      // 等待异步操作完成
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mockRecorderService.saveDraft).toHaveBeenCalled();
    });
    it('应该在自动保存失败时记录警告', async () => {
      const mockState = createMockGameState();
      let onUpdateCallback: ((state: IGameState) => void) | null = null;
      vi.mocked(mockRecorderService.setOnUpdate).mockImplementation((cb) => {
        onUpdateCallback = cb;
      });
      vi.mocked(mockRecorderService.saveDraft).mockRejectedValue(new Error('保存失败'));
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      // 模拟 state 变化
      if (onUpdateCallback) {
        onUpdateCallback(mockState);
      }
      // 等待异步操作完成
      await new Promise(resolve => setTimeout(resolve, 10));
    });
  });
  describe('记谱操作', () => {
    it('placeStone 应该委托给 RecorderService', () => {
      const mockResult: IMoveResult = { success: true, captured: [] };
      vi.mocked(mockRecorderService.placeStone).mockReturnValue(mockResult);
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      const result = app.placeStone(3, 3);
      expect(result.success).toBe(true);
      expect(mockRecorderService.placeStone).toHaveBeenCalledWith(3, 3);
    });
    it('pass 应该委托给 RecorderService', () => {
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      app.pass();
      expect(mockRecorderService.pass).toHaveBeenCalled();
    });
    it('undo 应该委托给 RecorderService', () => {
      vi.mocked(mockRecorderService.undo).mockReturnValue(true);
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      const result = app.undo();
      expect(result).toBe(true);
      expect(mockRecorderService.undo).toHaveBeenCalled();
    });
    it('newGame 应该委托给 RecorderService', () => {
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      app.newGame({ size: 19, komi: 7.5 });
      expect(mockRecorderService.newGame).toHaveBeenCalledWith({ size: 19, komi: 7.5 });
    });
    it('getState 应该委托给 RecorderService', () => {
      const mockState = createMockGameState();
      vi.mocked(mockRecorderService.getState).mockReturnValue(mockState);
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      const result = app.getState();
      expect(result).toEqual(mockState);
    });
    it('generateSGF 应该委托给 RecorderService', () => {
      vi.mocked(mockRecorderService.generateSGF).mockReturnValue('(;SZ[19])');
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      const result = app.generateSGF({ blackName: '黑方', whiteName: '白方' });
      expect(result).toBe('(;SZ[19])');
      expect(mockRecorderService.generateSGF).toHaveBeenCalledWith({ blackName: '黑方', whiteName: '白方' });
    });
  });
  describe('草稿管理', () => {
    it('saveDraft 应该委托给 RecorderService', async () => {
      vi.mocked(mockRecorderService.saveDraft).mockResolvedValue(undefined);
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      await app.saveDraft();
      expect(mockRecorderService.saveDraft).toHaveBeenCalled();
    });
    it('loadDraft 应该委托给 RecorderService', async () => {
      vi.mocked(mockRecorderService.loadDraft).mockResolvedValue(undefined);
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      await app.loadDraft();
      expect(mockRecorderService.loadDraft).toHaveBeenCalled();
    });
    it('clearDraft 应该委托给 RecorderService', async () => {
      vi.mocked(mockRecorderService.clearDraft).mockResolvedValue(undefined);
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      await app.clearDraft();
      expect(mockRecorderService.clearDraft).toHaveBeenCalled();
    });
  });
  describe('downloadSGF', () => {
    it('应该生成并导出 SGF', async () => {
      vi.mocked(mockRecorderService.generateSGF).mockReturnValue('(;SZ[19])');
      const mockResult: ExportResult = { success: true, path: '/path/to/file.sgf' };
      vi.mocked(mockExportService.exportSGF).mockResolvedValue(mockResult);
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      const result = await app.downloadSGF({ blackName: '柯洁', whiteName: '申真谞' });
      expect(result.success).toBe(true);
      expect(mockExportService.exportSGF).toHaveBeenCalledWith('(;SZ[19])', '柯洁_vs_申真谞');
    });
    it('应该使用默认名称当未提供 metadata', async () => {
      vi.mocked(mockRecorderService.generateSGF).mockReturnValue('(;SZ[19])');
      const mockResult: ExportResult = { success: true, path: '/path/to/file.sgf' };
      vi.mocked(mockExportService.exportSGF).mockResolvedValue(mockResult);
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      const result = await app.downloadSGF();
      expect(result.success).toBe(true);
      expect(mockExportService.exportSGF).toHaveBeenCalledWith('(;SZ[19])', '黑_vs_白');
    });
    it('应该处理导出失败', async () => {
      vi.mocked(mockRecorderService.generateSGF).mockReturnValue('(;SZ[19])');
      const mockResult: ExportResult = { success: false, error: '导出失败' };
      vi.mocked(mockExportService.exportSGF).mockResolvedValue(mockResult);
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      const result = await app.downloadSGF();
      expect(result.success).toBe(false);
      expect(result.error).toBe('导出失败');
    });
  });
  describe('saveToHistory', () => {
    it('应该归档棋谱并保存到收藏', async () => {
      const mockState = createMockGameState();
      vi.mocked(mockRecorderService.getState).mockReturnValue(mockState);
      vi.mocked(mockRecorderService.generateSGF).mockReturnValue('(;SZ[19]PB[柯洁]PW[申真谞])');
      const mockGameResult: GameServiceResult = {
        success: true,
        archiveId: 'archive-123',
        sgfContent: '(;SZ[19]PB[柯洁]PW[申真谞])',
        source: 'archive',
        url: 'archive:...',
        metadata: {} as any,
        fromCache: false,
      };
      vi.mocked(mockGameService.fetch).mockResolvedValue(mockGameResult);
      vi.mocked(mockFavoriteService.addFavorite).mockResolvedValue('fav-123');
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      const result = await app.saveToHistory({ blackName: '柯洁', whiteName: '申真谞' });
      expect(result).toBe('fav-123');
      expect(mockGameService.fetch).toHaveBeenCalled();
      expect(mockFavoriteService.addFavorite).toHaveBeenCalledWith(
        'recorder',
        'archive-123',
        expect.objectContaining({ blackName: '柯洁', whiteName: '申真谞' }),
        '柯洁 vs 申真谞'
      );
    });
    it('应该在归档失败时返回 null', async () => {
      const mockState = createMockGameState();
      vi.mocked(mockRecorderService.getState).mockReturnValue(mockState);
      vi.mocked(mockRecorderService.generateSGF).mockReturnValue('(;SZ[19])');
      const mockGameResult: GameServiceResult = {
        success: false,
        archiveId: '',
        sgfContent: null,
        source: 'archive',
        url: 'archive:...',
        metadata: {} as any,
        fromCache: false,
        error: '归档失败',
      };
      vi.mocked(mockGameService.fetch).mockResolvedValue(mockGameResult);
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      const result = await app.saveToHistory();
      expect(result).toBeNull();
    });
  });
  describe('queryHistory', () => {
    it('应该查询收藏历史', async () => {
      const mockFavorites: IFavoriteItem[] = [
        {
          id: 'fav-1',
          category: 'recorder',
          key: 'archive-1',
          data: { blackName: '柯洁', whiteName: '申真谞', moveCount: 250 },
          createdAt: Date.now(),
        },
      ];
      vi.mocked(mockFavoriteService.getFavorites).mockResolvedValue(mockFavorites);
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      const result = await app.queryHistory();
      expect(result).toHaveLength(1);
      expect(result[0].blackName).toBe('柯洁');
    });
    it('应该限制返回数量', async () => {
      const mockFavorites: IFavoriteItem[] = Array.from({ length: 30 }, (_, i) => ({
        id: `fav-${i}`,
        category: 'recorder',
        key: `archive-${i}`,
        data: { blackName: `黑${i}`, whiteName: `白${i}`, moveCount: i },
        createdAt: Date.now() - i * 1000,
      }));
      vi.mocked(mockFavoriteService.getFavorites).mockResolvedValue(mockFavorites);
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      const result = await app.queryHistory({ limit: 10 });
      expect(result).toHaveLength(10);
    });
  });
  describe('getHistoryDetail', () => {
    it('应该返回棋谱详情', async () => {
      const mockFavorite: IFavoriteItem = {
        id: 'fav-1',
        category: 'recorder',
        key: 'archive-123',
        data: { blackName: '柯洁', whiteName: '申真谞', moveCount: 250, size: 19 },
        createdAt: Date.now(),
      };
      vi.mocked(mockFavoriteService.getById).mockResolvedValue(mockFavorite);
      vi.mocked(mockGameService.getByArchiveId).mockResolvedValue('(;SZ[19])');
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      const result = await app.getHistoryDetail('fav-1');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('fav-1');
      expect(result?.sgf).toBe('(;SZ[19])');
      expect(result?.size).toBe(19);
    });
    it('应该在 ID 不存在时返回 null', async () => {
      vi.mocked(mockFavoriteService.getById).mockResolvedValue(null);
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      const result = await app.getHistoryDetail('non-existent');
      expect(result).toBeNull();
    });
  });
  describe('clearHistory', () => {
    it('应该清空棋谱历史', async () => {
      vi.mocked(mockFavoriteService.clear).mockResolvedValue(undefined);
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      await app.clearHistory();
      expect(mockFavoriteService.clear).toHaveBeenCalledWith('recorder');
    });
  });
  describe('getStats', () => {
    it('应该返回统计信息', async () => {
      vi.mocked(mockFavoriteService.count).mockResolvedValue(30);
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      const result = await app.getStats();
      expect(result.total).toBe(30);
      expect(result.today).toBe(0);
    });
  });
  describe('setOnUpdate', () => {
    it('应该委托给 RecorderService', () => {
      const callback = vi.fn();
      const app = new RecorderApp(
        mockRecorderService,
        mockExportService,
        mockHistoryManager,
      );
      app.setOnUpdate(callback);
      expect(mockRecorderService.setOnUpdate).toHaveBeenCalledWith(callback);
    });
  });
});
