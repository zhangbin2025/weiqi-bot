import { describe, it, expect, vi } from 'vitest';
import { HMPlayApp } from '../HMPlayApp';
import type {
  IHMPlayService,
  IHMPlayState,
  IHMPlayCallbacks,
  IHMPlayConfig,
  IAnalysisResult,
  Difficulty,
} from '../../../services/play/hm';
import type { IModelService, ModelConfig } from '../../../services/model';
import type { IActivityLogService, ActivityEntry } from '../../../services/activity';
/** 创建 mock HMPlayService */
function createMockHMPlayService(): IHMPlayService {
  const defaultState: IHMPlayState = {
    board: [] as unknown as IHMPlayState['board'],
    currentPlayer: 'black',
    moveHistory: [],
    capturedBlack: 0,
    capturedWhite: 0,
    scoreLead: 0,
    isAiThinking: false,
    gameEnded: false,
  };
  return {
    newGame: vi.fn().mockResolvedValue(undefined),
    playerMove: vi.fn().mockResolvedValue(true),
    playerPass: vi.fn().mockResolvedValue(undefined),
    undo: vi.fn().mockResolvedValue(true),
    analyze: vi.fn().mockResolvedValue({
      winRate: 0.55,
      scoreLead: 2.5,
      topMoves: [],
    } as IAnalysisResult),
    resign: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockReturnValue(defaultState),
    setCallbacks: vi.fn(),
    setDifficulty: vi.fn(),
    setModel: vi.fn().mockResolvedValue(undefined),
    cancelAiThinking: vi.fn(),
    isPlayerTurn: vi.fn().mockReturnValue(true),
    isEnded: vi.fn().mockReturnValue(false),
    canUndo: vi.fn().mockReturnValue(true),
    exportSgf: vi.fn().mockReturnValue('(;GM[1]FF[4])'),
  } as unknown as IHMPlayService;
}
/** 创建 mock ModelService */
function createMockModelService(): IModelService {
  const modelA: ModelConfig = { id: 'model-a', name: 'Model A', url: 'http://a', size: 100 };
  const modelB: ModelConfig = { id: 'model-b', name: 'Model B', url: 'http://b', size: 200 };
  let current: ModelConfig | null = modelA;
  return {
    loadConfig: vi.fn().mockResolvedValue({ models: [modelA, modelB] }),
    getModels: vi.fn().mockResolvedValue([modelA, modelB]),
    getCurrentModel: vi.fn().mockImplementation(() => current),
    switchModel: vi.fn().mockImplementation((id: string) => {
      if (id === modelA.id) { current = modelA; return; }
      if (id === modelB.id) { current = modelB; return; }
      throw new Error(`Model ${id} not found`);
    }),
    downloadModel: vi.fn(),
    isCached: vi.fn().mockResolvedValue(true),
    getCachedModels: vi.fn().mockResolvedValue([]),
    deleteCache: vi.fn(),
    clearAllCache: vi.fn(),
  } as unknown as IModelService;
}
/** 创建 mock ActivityLogService */
function createMockActivityLogService(): IActivityLogService {
  return {
    record: vi.fn().mockResolvedValue('act:1:xyz'),
    query: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    stats: vi.fn().mockResolvedValue({ total: 0, today: 0, thisWeek: 0, thisMonth: 0, byType: {} }),
    count: vi.fn().mockResolvedValue(0),
    clear: vi.fn(),
  } as unknown as IActivityLogService;
}
describe('HMPlayApp', () => {
  describe('构造函数', () => {
    it('应该接受无参数构造', () => {
      const app = new HMPlayApp();
      expect(app).toBeDefined();
    });
    it('应该接受全部参数构造', () => {
      const app = new HMPlayApp(
        createMockHMPlayService(),
        createMockModelService(),
        createMockActivityLogService(),
      );
      expect(app).toBeDefined();
    });
  });
  describe('对弈操作 - 缺少服务时抛错', () => {
    it('无 HMPlayService 时 newGame 应抛错', () => {
      const app = new HMPlayApp();
      const config: IHMPlayConfig = {
        playerColor: 'black',
        handicap: 0,
        difficulty: 'medium',
        noUndo: false,
        modelId: 'model-a',
      };
      expect(() => app.newGame(config)).toThrow('HMPlayService not provided');
    });
    it('无 HMPlayService 时 playerMove 应抛错', () => {
      const app = new HMPlayApp();
      expect(() => app.playerMove(3, 3)).toThrow('HMPlayService not provided');
    });
    it('无 HMPlayService 时 playerPass 应抛错', () => {
      const app = new HMPlayApp();
      expect(() => app.playerPass()).toThrow('HMPlayService not provided');
    });
    it('无 HMPlayService 时 undo 应抛错', () => {
      const app = new HMPlayApp();
      expect(() => app.undo()).toThrow('HMPlayService not provided');
    });
    it('无 HMPlayService 时 analyze 应抛错', () => {
      const app = new HMPlayApp();
      expect(() => app.analyze()).toThrow('HMPlayService not provided');
    });
    it('无 HMPlayService 时 resign 应抛错', () => {
      const app = new HMPlayApp();
      expect(() => app.resign()).toThrow('HMPlayService not provided');
    });
    it('无 HMPlayService 时 getState 应抛错', () => {
      const app = new HMPlayApp();
      expect(() => app.getState()).toThrow('HMPlayService not provided');
    });
  });
  describe('对弈操作 - 代理到 HMPlayService', () => {
    it('newGame 应代理到服务', async () => {
      const play = createMockHMPlayService();
      const app = new HMPlayApp(play);
      const config: IHMPlayConfig = {
        playerColor: 'black',
        handicap: 0,
        difficulty: 'medium',
        noUndo: false,
        modelId: 'model-a',
      };
      await app.newGame(config);
      expect(play.newGame).toHaveBeenCalledWith(config);
    });
    it('playerMove 应代理到服务', async () => {
      const play = createMockHMPlayService();
      const app = new HMPlayApp(play);
      const result = await app.playerMove(3, 3);
      expect(play.playerMove).toHaveBeenCalledWith(3, 3);
      expect(result).toBe(true);
    });
    it('playerPass 应代理到服务', async () => {
      const play = createMockHMPlayService();
      const app = new HMPlayApp(play);
      await app.playerPass();
      expect(play.playerPass).toHaveBeenCalled();
    });
    it('undo 应代理到服务', async () => {
      const play = createMockHMPlayService();
      const app = new HMPlayApp(play);
      const result = await app.undo();
      expect(play.undo).toHaveBeenCalled();
      expect(result).toBe(true);
    });
    it('analyze 应代理到服务', async () => {
      const play = createMockHMPlayService();
      const app = new HMPlayApp(play);
      const result = await app.analyze();
      expect(play.analyze).toHaveBeenCalled();
      expect(result.winRate).toBe(0.55);
    });
    it('resign 应代理到服务', async () => {
      const play = createMockHMPlayService();
      const app = new HMPlayApp(play);
      await app.resign();
      expect(play.resign).toHaveBeenCalled();
    });
    it('getState 应代理到服务', () => {
      const play = createMockHMPlayService();
      const app = new HMPlayApp(play);
      const state = app.getState();
      expect(play.getState).toHaveBeenCalled();
      expect(state).toBeDefined();
    });
    it('setCallbacks 应代理到服务', () => {
      const play = createMockHMPlayService();
      const app = new HMPlayApp(play);
      const callbacks: IHMPlayCallbacks = { onBoardChange: vi.fn() };
      app.setCallbacks(callbacks);
      expect(play.setCallbacks).toHaveBeenCalledWith(callbacks);
    });
    it('setDifficulty 应代理到服务', () => {
      const play = createMockHMPlayService();
      const app = new HMPlayApp(play);
      app.setDifficulty('hard' as Difficulty);
      expect(play.setDifficulty).toHaveBeenCalledWith('hard');
    });
    it('setModel 应代理到服务', async () => {
      const play = createMockHMPlayService();
      const app = new HMPlayApp(play);
      await app.setModel('model-b');
      expect(play.setModel).toHaveBeenCalledWith('model-b');
    });
    it('cancelAiThinking 应代理到服务', () => {
      const play = createMockHMPlayService();
      const app = new HMPlayApp(play);
      app.cancelAiThinking();
      expect(play.cancelAiThinking).toHaveBeenCalled();
    });
    it('isPlayerTurn 应代理到服务', () => {
      const play = createMockHMPlayService();
      const app = new HMPlayApp(play);
      const result = app.isPlayerTurn();
      expect(play.isPlayerTurn).toHaveBeenCalled();
      expect(result).toBe(true);
    });
    it('isEnded 应代理到服务', () => {
      const play = createMockHMPlayService();
      const app = new HMPlayApp(play);
      const result = app.isEnded();
      expect(play.isEnded).toHaveBeenCalled();
      expect(result).toBe(false);
    });
    it('canUndo 应代理到服务', () => {
      const play = createMockHMPlayService();
      const app = new HMPlayApp(play);
      const result = app.canUndo();
      expect(play.canUndo).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });
  describe('模型管理', () => {
    it('应该获取可用模型列表', async () => {
      const modelService = createMockModelService();
      const app = new HMPlayApp(undefined, modelService);
      const models = await app.getModels();
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('model-a');
    });
    it('无 ModelService 时 getModels 应抛错', () => {
      const app = new HMPlayApp();
      expect(() => app.getModels()).toThrow('ModelService not provided');
    });
    it('应该获取当前模型', () => {
      const modelService = createMockModelService();
      const app = new HMPlayApp(undefined, modelService);
      const current = app.getCurrentModel();
      expect(current).not.toBeNull();
      expect(current!.id).toBe('model-a');
    });
    it('无 ModelService 时 getCurrentModel 应抛错', () => {
      const app = new HMPlayApp();
      expect(() => app.getCurrentModel()).toThrow('ModelService not provided');
    });
    it('应该切换模型', async () => {
      const modelService = createMockModelService();
      const app = new HMPlayApp(undefined, modelService);
      await app.switchModel('model-b');
      expect(modelService.switchModel).toHaveBeenCalledWith('model-b', undefined);
    });
    it('无 ModelService 时 switchModel 应抛错', () => {
      const app = new HMPlayApp();
      expect(() => app.switchModel('model-a')).toThrow('ModelService not provided');
    });
  });
  describe('历史管理', () => {
    it('saveToHistory 应记录活动', async () => {
      const play = createMockHMPlayService();
      const activity = createMockActivityLogService();
      const app = new HMPlayApp(play, undefined, activity);
      const id = await app.saveToHistory();
      expect(activity.record).toHaveBeenCalledWith(
        'play_hm',
        expect.any(String),
        expect.objectContaining({ blackName: '玩家', whiteName: 'AI' }),
        ['对弈', '人机对弈'],
      );
      expect(id).toBe('act:1:xyz');
    });
    it('saveToHistory 无 HMPlayService 时应抛错', async () => {
      const app = new HMPlayApp();
      await expect(app.saveToHistory()).rejects.toThrow('HMPlayService not provided');
    });
    it('saveToHistory 无 ActivityLogService 时应抛错', async () => {
      const play = createMockHMPlayService();
      const app = new HMPlayApp(play);
      await expect(app.saveToHistory()).rejects.toThrow('ActivityLogService not provided');
    });
    it('queryHistory 无 ActivityLogService 时返回空数组', async () => {
      const app = new HMPlayApp();
      const entries = await app.queryHistory();
      expect(entries).toEqual([]);
    });
    it('queryHistory 有 ActivityLogService 时应查询', async () => {
      const activity = createMockActivityLogService();
      (activity.query as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: '1', data: { blackName: '玩家', whiteName: 'AI', moveCount: 50 }, createdAt: 1000 },
      ]);
      const app = new HMPlayApp(undefined, undefined, activity);
      const entries = await app.queryHistory({ keyword: '玩家', limit: 10 });
      expect(activity.query).toHaveBeenCalledWith({
        type: 'play_hm', keyword: '玩家', limit: 10, offset: undefined,
      });
      expect(entries).toHaveLength(1);
    });
    it('getHistoryDetail 无 ActivityLogService 时返回 null', async () => {
      const app = new HMPlayApp();
      const detail = await app.getHistoryDetail('1');
      expect(detail).toBeNull();
    });
    it('getHistoryDetail 有 ActivityLogService 时应查询', async () => {
      const activity = createMockActivityLogService();
      const entry: ActivityEntry = { id: '1', type: 'play_hm', title: 'test', data: {}, tags: [], createdAt: 0 };
      (activity.getById as ReturnType<typeof vi.fn>).mockResolvedValue(entry);
      const app = new HMPlayApp(undefined, undefined, activity);
      const detail = await app.getHistoryDetail('1');
      expect(activity.getById).toHaveBeenCalledWith('1');
      expect(detail).toEqual(entry);
    });
    it('clearHistory 无 ActivityLogService 时应抛错', async () => {
      const app = new HMPlayApp();
      await expect(app.clearHistory()).rejects.toThrow('ActivityLogService not provided');
    });
    it('clearHistory 应代理到 ActivityLogService', async () => {
      const activity = createMockActivityLogService();
      const app = new HMPlayApp(undefined, undefined, activity);
      await app.clearHistory();
      expect(activity.clear).toHaveBeenCalledWith('play_hm');
    });
    it('getStats 无 ActivityLogService 时返回零值', async () => {
      const app = new HMPlayApp();
      const stats = await app.getStats();
      expect(stats).toEqual({ total: 0, wins: 0, losses: 0, today: 0 });
    });
    it('getStats 有 ActivityLogService 时应返回统计', async () => {
      const activity = createMockActivityLogService();
      (activity.stats as ReturnType<typeof vi.fn>).mockResolvedValue({
        total: 10, today: 2, thisWeek: 5, thisMonth: 8, byType: { play_hm: 5 },
      });
      const app = new HMPlayApp(undefined, undefined, activity);
      const stats = await app.getStats();
      expect(stats).toEqual({ total: 5, wins: 0, losses: 0, today: 2 });
    });
  });
});