import { describe, it, expect, vi } from 'vitest';
import { MMPlayApp } from '../MMPlayApp';
import type { IMMPlayService, IMMPlayCallbacks } from '../../../services/play/mm/IMMPlayService';
import type { IMMPlayState, IMMPlayConfig } from '../../../services/play/mm/types';
import type { IModelService, ModelConfig } from '../../../services/model';
import type { IActivityLogService, ActivityEntry } from '../../../services/activity';
/** 创建 mock MMPlayService */
function createMockMMPlayService(): IMMPlayService {
  const defaultState: IMMPlayState = {
    board: [] as unknown as IMMPlayState['board'],
    currentPlayer: 'black',
    moveHistory: [],
    currentMove: 0,
    isRunning: false,
    isPaused: false,
    gameEnded: false,
  };
  return {
    setup: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    step: vi.fn().mockResolvedValue(true),
    getState: vi.fn().mockReturnValue(defaultState),
    setCallbacks: vi.fn(),
    setSpeed: vi.fn(),
    setVisits: vi.fn(),
    exportSgf: vi.fn().mockReturnValue('(;GM[1]FF[4])'),
  } as unknown as IMMPlayService;
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
    record: vi.fn().mockResolvedValue('act:1:mm'),
    query: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    stats: vi.fn().mockResolvedValue({ total: 0, today: 0, thisWeek: 0, thisMonth: 0, byType: {} }),
    count: vi.fn().mockResolvedValue(0),
    clear: vi.fn(),
  } as unknown as IActivityLogService;
}
describe('MMPlayApp', () => {
  describe('构造函数', () => {
    it('应该接受无参数构造', () => {
      const app = new MMPlayApp();
      expect(app).toBeDefined();
    });
    it('应该接受全部参数构造', () => {
      const app = new MMPlayApp(
        createMockMMPlayService(),
        createMockModelService(),
        createMockActivityLogService(),
      );
      expect(app).toBeDefined();
    });
  });
  describe('自对弈操作 - 缺少服务时抛错', () => {
    it('无 MMPlayService 时 setup 应抛错', () => {
      const app = new MMPlayApp();
      const config: IMMPlayConfig = { modelId: 'model-a', visits: 100, speed: 'normal' };
      expect(() => app.setup(config)).toThrow('MMPlayService not provided');
    });
    it('无 MMPlayService 时 start 应抛错', () => {
      const app = new MMPlayApp();
      expect(() => app.start()).toThrow('MMPlayService not provided');
    });
    it('无 MMPlayService 时 pause 应抛错', () => {
      const app = new MMPlayApp();
      expect(() => app.pause()).toThrow('MMPlayService not provided');
    });
    it('无 MMPlayService 时 resume 应抛错', () => {
      const app = new MMPlayApp();
      expect(() => app.resume()).toThrow('MMPlayService not provided');
    });
    it('无 MMPlayService 时 stop 应抛错', () => {
      const app = new MMPlayApp();
      expect(() => app.stop()).toThrow('MMPlayService not provided');
    });
    it('无 MMPlayService 时 step 应抛错', () => {
      const app = new MMPlayApp();
      expect(() => app.step()).toThrow('MMPlayService not provided');
    });
    it('无 MMPlayService 时 getState 应抛错', () => {
      const app = new MMPlayApp();
      expect(() => app.getState()).toThrow('MMPlayService not provided');
    });
  });
  describe('自对弈操作 - 代理到 MMPlayService', () => {
    it('setup 应代理到服务', async () => {
      const play = createMockMMPlayService();
      const app = new MMPlayApp(play);
      const config: IMMPlayConfig = { modelId: 'model-a', visits: 100, speed: 'normal' };
      await app.setup(config);
      expect(play.setup).toHaveBeenCalledWith(config, undefined, undefined);
    });
    it('start 应代理到服务', async () => {
      const play = createMockMMPlayService();
      const app = new MMPlayApp(play);
      await app.start();
      expect(play.start).toHaveBeenCalled();
    });
    it('pause 应代理到服务', () => {
      const play = createMockMMPlayService();
      const app = new MMPlayApp(play);
      app.pause();
      expect(play.pause).toHaveBeenCalled();
    });
    it('resume 应代理到服务', () => {
      const play = createMockMMPlayService();
      const app = new MMPlayApp(play);
      app.resume();
      expect(play.resume).toHaveBeenCalled();
    });
    it('stop 应代理到服务', () => {
      const play = createMockMMPlayService();
      const app = new MMPlayApp(play);
      app.stop();
      expect(play.stop).toHaveBeenCalled();
    });
    it('step 应代理到服务', async () => {
      const play = createMockMMPlayService();
      const app = new MMPlayApp(play);
      const result = await app.step();
      expect(play.step).toHaveBeenCalled();
      expect(result).toBe(true);
    });
    it('getState 应代理到服务', () => {
      const play = createMockMMPlayService();
      const app = new MMPlayApp(play);
      const state = app.getState();
      expect(play.getState).toHaveBeenCalled();
      expect(state).toBeDefined();
    });
    it('setCallbacks 应代理到服务', () => {
      const play = createMockMMPlayService();
      const app = new MMPlayApp(play);
      const callbacks: IMMPlayCallbacks = { onBoardChange: vi.fn() };
      app.setCallbacks(callbacks);
      expect(play.setCallbacks).toHaveBeenCalledWith(callbacks);
    });
  });
  describe('模型管理', () => {
    it('应该获取可用模型列表', async () => {
      const modelService = createMockModelService();
      const app = new MMPlayApp(undefined, modelService);
      const models = await app.getModels();
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('model-a');
    });
    it('无 ModelService 时 getModels 应抛错', () => {
      const app = new MMPlayApp();
      expect(() => app.getModels()).toThrow('ModelService not provided');
    });
    it('应该获取当前模型', () => {
      const modelService = createMockModelService();
      const app = new MMPlayApp(undefined, modelService);
      const current = app.getCurrentModel();
      expect(current).not.toBeNull();
      expect(current!.id).toBe('model-a');
    });
    it('无 ModelService 时 getCurrentModel 应抛错', () => {
      const app = new MMPlayApp();
      expect(() => app.getCurrentModel()).toThrow('ModelService not provided');
    });
    it('应该切换模型', async () => {
      const modelService = createMockModelService();
      const app = new MMPlayApp(undefined, modelService);
      await app.switchModel('model-b');
      expect(modelService.switchModel).toHaveBeenCalledWith('model-b', undefined);
    });
    it('无 ModelService 时 switchModel 应抛错', () => {
      const app = new MMPlayApp();
      expect(() => app.switchModel('model-a')).toThrow('ModelService not provided');
    });
  });
  describe('历史管理', () => {
    it('saveToHistory 应记录活动', async () => {
      const play = createMockMMPlayService();
      const model = createMockModelService();
      const activity = createMockActivityLogService();
      const app = new MMPlayApp(play, model, activity);
      const id = await app.saveToHistory();
      expect(activity.record).toHaveBeenCalledWith(
        'play_mm',
        expect.any(String),
        expect.objectContaining({ sgf: '(;GM[1]FF[4])', modelId: 'model-a' }),
        ['对弈', 'AI自对弈'],
      );
      expect(id).toBe('act:1:mm');
    });
    it('saveToHistory 无 MMPlayService 时应抛错', async () => {
      const app = new MMPlayApp();
      await expect(app.saveToHistory()).rejects.toThrow('MMPlayService not provided');
    });
    it('saveToHistory 无 ActivityLogService 时应抛错', async () => {
      const play = createMockMMPlayService();
      const app = new MMPlayApp(play);
      await expect(app.saveToHistory()).rejects.toThrow('ActivityLogService not provided');
    });
    it('queryHistory 无 ActivityLogService 时返回空数组', async () => {
      const app = new MMPlayApp();
      const entries = await app.queryHistory();
      expect(entries).toEqual([]);
    });
    it('queryHistory 有 ActivityLogService 时应查询', async () => {
      const activity = createMockActivityLogService();
      (activity.query as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: '1', data: { modelId: 'model-a', moveCount: 100 }, createdAt: 1000 },
      ]);
      const app = new MMPlayApp(undefined, undefined, activity);
      const entries = await app.queryHistory({ keyword: 'test', limit: 10 });
      expect(activity.query).toHaveBeenCalledWith({
        type: 'play_mm', keyword: 'test', limit: 10, offset: undefined,
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].blackName).toBe('AI(model-a)');
      expect(entries[0].whiteName).toBe('AI(model-a)');
    });
    it('getHistoryDetail 无 ActivityLogService 时返回 null', async () => {
      const app = new MMPlayApp();
      const detail = await app.getHistoryDetail('1');
      expect(detail).toBeNull();
    });
    it('getHistoryDetail 有 ActivityLogService 时应查询', async () => {
      const activity = createMockActivityLogService();
      const entry: ActivityEntry = { id: '1', type: 'play_mm', title: 'test', data: {}, tags: [], createdAt: 0 };
      (activity.getById as ReturnType<typeof vi.fn>).mockResolvedValue(entry);
      const app = new MMPlayApp(undefined, undefined, activity);
      const detail = await app.getHistoryDetail('1');
      expect(activity.getById).toHaveBeenCalledWith('1');
      expect(detail).toEqual(entry);
    });
    it('clearHistory 无 ActivityLogService 时应抛错', async () => {
      const app = new MMPlayApp();
      await expect(app.clearHistory()).rejects.toThrow('ActivityLogService not provided');
    });
    it('clearHistory 应代理到 ActivityLogService', () => {
      const activity = createMockActivityLogService();
      const app = new MMPlayApp(undefined, undefined, activity);
      app.clearHistory();
      expect(activity.clear).toHaveBeenCalledWith('play_mm');
    });
    it('getStats 无 ActivityLogService 时返回零值', async () => {
      const app = new MMPlayApp();
      const stats = await app.getStats();
      expect(stats).toEqual({ total: 0, wins: 0, losses: 0, today: 0 });
    });
    it('getStats 有 ActivityLogService 时应返回统计', async () => {
      const activity = createMockActivityLogService();
      (activity.stats as ReturnType<typeof vi.fn>).mockResolvedValue({
        total: 10, today: 2, thisWeek: 5, thisMonth: 8, byType: { play_mm: 3 },
      });
      const app = new MMPlayApp(undefined, undefined, activity);
      const stats = await app.getStats();
      expect(stats).toEqual({ total: 3, wins: 0, losses: 0, today: 2 });
    });
  });
  describe('saveToHistory - 计算胜负', () => {
    it('黑方胜时应记录 winner 为 black', async () => {
      const play = createMockMMPlayService();
      const model = createMockModelService();
      const activity = createMockActivityLogService();
      const endedState: IMMPlayState = {
        board: [] as unknown as IMMPlayState['board'],
        currentPlayer: 'white',
        moveHistory: [{ x: 0, y: 0, color: 'black', moveNum: 1 }],
        currentMove: 1,
        isRunning: false,
        isPaused: false,
        gameEnded: true,
        blackScore: 100,
        whiteScore: 50,
      };
      (play.getState as ReturnType<typeof vi.fn>).mockReturnValue(endedState);
      const app = new MMPlayApp(play, model, activity);
      await app.saveToHistory();
      expect(activity.record).toHaveBeenCalledWith(
        'play_mm',
        expect.any(String),
        expect.objectContaining({ winner: 'black' }),
        ['对弈', 'AI自对弈'],
      );
    });
    it('白方胜时应记录 winner 为 white', async () => {
      const play = createMockMMPlayService();
      const model = createMockModelService();
      const activity = createMockActivityLogService();
      const endedState: IMMPlayState = {
        board: [] as unknown as IMMPlayState['board'],
        currentPlayer: 'black',
        moveHistory: [{ x: 0, y: 0, color: 'white', moveNum: 1 }],
        currentMove: 1,
        isRunning: false,
        isPaused: false,
        gameEnded: true,
        blackScore: 50,
        whiteScore: 100,
      };
      (play.getState as ReturnType<typeof vi.fn>).mockReturnValue(endedState);
      const app = new MMPlayApp(play, model, activity);
      await app.saveToHistory();
      expect(activity.record).toHaveBeenCalledWith(
        'play_mm',
        expect.any(String),
        expect.objectContaining({ winner: 'white' }),
        ['对弈', 'AI自对弈'],
      );
    });
    it('和棋时应记录 winner 为 draw', async () => {
      const play = createMockMMPlayService();
      const model = createMockModelService();
      const activity = createMockActivityLogService();
      const endedState: IMMPlayState = {
        board: [] as unknown as IMMPlayState['board'],
        currentPlayer: 'black',
        moveHistory: [],
        currentMove: 0,
        isRunning: false,
        isPaused: false,
        gameEnded: true,
        blackScore: 100,
        whiteScore: 100,
      };
      (play.getState as ReturnType<typeof vi.fn>).mockReturnValue(endedState);
      const app = new MMPlayApp(play, model, activity);
      await app.saveToHistory();
      expect(activity.record).toHaveBeenCalledWith(
        'play_mm',
        expect.any(String),
        expect.objectContaining({ winner: 'draw' }),
        ['对弈', 'AI自对弈'],
      );
    });
    it('游戏未结束时不记录 winner', async () => {
      const play = createMockMMPlayService();
      const model = createMockModelService();
      const activity = createMockActivityLogService();
      const runningState: IMMPlayState = {
        board: [] as unknown as IMMPlayState['board'],
        currentPlayer: 'black',
        moveHistory: [],
        currentMove: 0,
        isRunning: true,
        isPaused: false,
        gameEnded: false,
      };
      (play.getState as ReturnType<typeof vi.fn>).mockReturnValue(runningState);
      const app = new MMPlayApp(play, model, activity);
      await app.saveToHistory();
      expect(activity.record).toHaveBeenCalledWith(
        'play_mm',
        expect.any(String),
        expect.not.objectContaining({ winner: expect.anything() }),
        ['对弈', 'AI自对弈'],
      );
    });
  });
});