import { describe, it, expect, vi } from 'vitest';
import { HHPlayApp } from '../HHPlayApp';
import type { IHHPlayService, IHHPlayState, IHHPlayCallbacks, IRoomInfo, IPlayerInfo } from '../../../services/play/hh';
import type { IModelService, ModelConfig } from '../../../services/model';
import type { IActivityLogService, ActivityEntry } from '../../../services/activity';
/** 创建 mock HHPlayService */
function createMockHHPlayService(): IHHPlayService {
  const defaultState: IHHPlayState = {
    room: null,
    me: null,
    opponent: null,
    board: [] as unknown as IHHPlayState['board'],
    currentPlayer: 'black',
    moveHistory: [],
    blackTime: 0,
    whiteTime: 0,
    gameEnded: false,
    inGame: false,
  };
  return {
    createRoom: vi.fn().mockResolvedValue({ id: 'room-1', name: '测试房间' } as IRoomInfo),
    joinRoom: vi.fn().mockResolvedValue({ id: 'p1', name: '玩家', color: 'black' } as IPlayerInfo),
    move: vi.fn().mockResolvedValue(undefined),
    pass: vi.fn().mockResolvedValue(undefined),
    requestUndo: vi.fn().mockResolvedValue(undefined),
    respondUndo: vi.fn().mockResolvedValue(undefined),
    resign: vi.fn().mockResolvedValue(undefined),
    reconnect: vi.fn().mockResolvedValue(undefined),
    leaveRoom: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockReturnValue(defaultState),
    setCallbacks: vi.fn(),
    getMoveHistory: vi.fn().mockReturnValue([]),
    exportSgf: vi.fn().mockReturnValue('(;GM[1]FF[4])'),
    countTerritory: vi.fn().mockResolvedValue({ blackTerritory: 50, whiteTerritory: 45, scoreLead: 5, winner: 'black' as const }),
  } as unknown as IHHPlayService;
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
    record: vi.fn().mockResolvedValue('act:1:abc'),
    query: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    stats: vi.fn().mockResolvedValue({ total: 0, today: 0, thisWeek: 0, thisMonth: 0, byType: {} }),
    count: vi.fn().mockResolvedValue(0),
    clear: vi.fn(),
  } as unknown as IActivityLogService;
}
describe('HHPlayApp', () => {
  describe('构造函数', () => {
    it('应该接受无参数构造', () => {
      const app = new HHPlayApp();
      expect(app).toBeDefined();
    });
    it('应该接受全部参数构造', () => {
      const app = new HHPlayApp(
        createMockHHPlayService(),
        createMockModelService(),
        createMockActivityLogService(),
      );
      expect(app).toBeDefined();
    });
  });
  describe('对弈操作 - 缺少服务时抛错', () => {
    it('无 HHPlayService 时 createRoom 应抛错', () => {
      const app = new HHPlayApp();
      expect(() => app.createRoom('test', {})).toThrow('HHPlayService not provided');
    });
    it('无 HHPlayService 时 joinRoom 应抛错', () => {
      const app = new HHPlayApp();
      expect(() => app.joinRoom('room-1', '玩家')).toThrow('HHPlayService not provided');
    });
    it('无 HHPlayService 时 move 应抛错', () => {
      const app = new HHPlayApp();
      expect(() => app.move(3, 3)).toThrow('HHPlayService not provided');
    });
    it('无 HHPlayService 时 pass 应抛错', () => {
      const app = new HHPlayApp();
      expect(() => app.pass()).toThrow('HHPlayService not provided');
    });
    it('无 HHPlayService 时 resign 应抛错', () => {
      const app = new HHPlayApp();
      expect(() => app.resign()).toThrow('HHPlayService not provided');
    });
    it('无 HHPlayService 时 getState 应抛错', () => {
      const app = new HHPlayApp();
      expect(() => app.getState()).toThrow('HHPlayService not provided');
    });
    it('无 HHPlayService 时 countTerritory 应抛错', async () => {
      const app = new HHPlayApp();
      await expect(app.countTerritory(6.5)).rejects.toThrow('HHPlayService not provided');
    });
  });
  describe('对弈操作 - 代理到 HHPlayService', () => {
    it('createRoom 应代理到服务', async () => {
      const play = createMockHHPlayService();
      const app = new HHPlayApp(play);
      const room = await app.createRoom('房间', { timeLimit: 30 });
      expect(play.createRoom).toHaveBeenCalledWith('房间', { timeLimit: 30 });
      expect(room.id).toBe('room-1');
    });
    it('joinRoom 应代理到服务', async () => {
      const play = createMockHHPlayService();
      const app = new HHPlayApp(play);
      await app.joinRoom('room-1', '玩家');
      expect(play.joinRoom).toHaveBeenCalledWith('room-1', '玩家');
    });
    it('move 应代理到服务', async () => {
      const play = createMockHHPlayService();
      const app = new HHPlayApp(play);
      await app.move(3, 3);
      expect(play.move).toHaveBeenCalledWith(3, 3);
    });
    it('pass 应代理到服务', async () => {
      const play = createMockHHPlayService();
      const app = new HHPlayApp(play);
      await app.pass();
      expect(play.pass).toHaveBeenCalled();
    });
    it('requestUndo 应代理到服务', async () => {
      const play = createMockHHPlayService();
      const app = new HHPlayApp(play);
      await app.requestUndo();
      expect(play.requestUndo).toHaveBeenCalled();
    });
    it('respondUndo 应代理到服务', async () => {
      const play = createMockHHPlayService();
      const app = new HHPlayApp(play);
      await app.respondUndo(true);
      expect(play.respondUndo).toHaveBeenCalledWith(true);
    });
    it('resign 应代理到服务', async () => {
      const play = createMockHHPlayService();
      const app = new HHPlayApp(play);
      await app.resign();
      expect(play.resign).toHaveBeenCalled();
    });
    it('reconnect 应代理到服务', async () => {
      const play = createMockHHPlayService();
      const app = new HHPlayApp(play);
      await app.reconnect();
      expect(play.reconnect).toHaveBeenCalled();
    });
    it('leaveRoom 应代理到服务', async () => {
      const play = createMockHHPlayService();
      const app = new HHPlayApp(play);
      await app.leaveRoom();
      expect(play.leaveRoom).toHaveBeenCalled();
    });
    it('getState 应代理到服务', () => {
      const play = createMockHHPlayService();
      const app = new HHPlayApp(play);
      const state = app.getState();
      expect(play.getState).toHaveBeenCalled();
      expect(state).toBeDefined();
    });
    it('setCallbacks 应代理到服务', () => {
      const play = createMockHHPlayService();
      const app = new HHPlayApp(play);
      const callbacks: IHHPlayCallbacks = { onMove: vi.fn() };
      app.setCallbacks(callbacks);
      expect(play.setCallbacks).toHaveBeenCalledWith(callbacks);
    });
    it('getMoveHistory 应代理到服务', () => {
      const play = createMockHHPlayService();
      const app = new HHPlayApp(play);
      const history = app.getMoveHistory();
      expect(play.getMoveHistory).toHaveBeenCalled();
      expect(history).toEqual([]);
    });
    it('exportSgf 应代理到服务', () => {
      const play = createMockHHPlayService();
      const app = new HHPlayApp(play);
      const sgf = app.exportSgf();
      expect(play.exportSgf).toHaveBeenCalled();
      expect(sgf).toBe('(;GM[1]FF[4])');
    });
    it('countTerritory 应代理到服务', async () => {
      const play = createMockHHPlayService();
      const app = new HHPlayApp(play);
      const result = await app.countTerritory(6.5);
      expect(play.countTerritory).toHaveBeenCalledWith(6.5);
      expect(result).toEqual({ blackTerritory: 50, whiteTerritory: 45, scoreLead: 5, winner: 'black' });
    });
  });
  describe('模型管理', () => {
    it('应该获取可用模型列表', async () => {
      const modelService = createMockModelService();
      const app = new HHPlayApp(undefined, modelService);
      const models = await app.getModels();
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('model-a');
    });
    it('无 ModelService 时 getModels 应抛错', () => {
      const app = new HHPlayApp();
      expect(() => app.getModels()).toThrow('ModelService not provided');
    });
    it('应该获取当前模型', () => {
      const modelService = createMockModelService();
      const app = new HHPlayApp(undefined, modelService);
      const current = app.getCurrentModel();
      expect(current).not.toBeNull();
      expect(current!.id).toBe('model-a');
    });
    it('无 ModelService 时 getCurrentModel 应抛错', () => {
      const app = new HHPlayApp();
      expect(() => app.getCurrentModel()).toThrow('ModelService not provided');
    });
    it('应该切换模型', async () => {
      const modelService = createMockModelService();
      const app = new HHPlayApp(undefined, modelService);
      await app.switchModel('model-b');
      expect(modelService.switchModel).toHaveBeenCalledWith('model-b');
    });
    it('无 ModelService 时 switchModel 应抛错', () => {
      const app = new HHPlayApp();
      expect(() => app.switchModel('model-a')).toThrow('ModelService not provided');
    });
  });
  describe('历史管理', () => {
    it('saveToHistory 应记录活动', async () => {
      const play = createMockHHPlayService();
      const activity = createMockActivityLogService();
      const app = new HHPlayApp(play, undefined, activity);
      const id = await app.saveToHistory({
        winner: 'black',
        reason: 'resign',
        scoreLead: 5,
      });
      expect(activity.record).toHaveBeenCalledWith(
        'play_hh',
        expect.any(String),
        expect.objectContaining({ moveCount: 0, winner: 'black', reason: 'resign', scoreLead: 5 }),
        ['对弈', '真人对弈'],
      );
      expect(id).toBe('act:1:abc');
    });
    it('saveToHistory 无 ActivityLogService 时应返回 null', async () => {
      const play = createMockHHPlayService();
      const app = new HHPlayApp(play);
      // 没有 ActivityLogService 时，优雅降级返回 null
      const result = await app.saveToHistory();
      expect(result).toBeNull();
    });
    it('queryHistory 无 ActivityLogService 时返回空数组', async () => {
      const app = new HHPlayApp();
      const entries = await app.queryHistory();
      expect(entries).toEqual([]);
    });
    it('queryHistory 有 ActivityLogService 时应查询', async () => {
      const activity = createMockActivityLogService();
      (activity.query as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: '1', data: { blackName: 'A', whiteName: 'B', moveCount: 50 }, createdAt: 1000 },
      ]);
      const app = new HHPlayApp(undefined, undefined, activity);
      const entries = await app.queryHistory({ keyword: 'A', limit: 10 });
      expect(activity.query).toHaveBeenCalledWith({
        type: 'play_hh', keyword: 'A', limit: 10, offset: undefined,
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual({ id: '1', blackName: 'A', whiteName: 'B', moveCount: 50, result: undefined, playedAt: 1000 });
    });
    it('getHistoryDetail 无 ActivityLogService 时返回 null', async () => {
      const app = new HHPlayApp();
      const detail = await app.getHistoryDetail('1');
      expect(detail).toBeNull();
    });
    it('getHistoryDetail 有 ActivityLogService 时应查询', async () => {
      const activity = createMockActivityLogService();
      const entry: ActivityEntry = { id: '1', type: 'play_hh', title: 'test', data: {}, tags: [], createdAt: 0 };
      (activity.getById as ReturnType<typeof vi.fn>).mockResolvedValue(entry);
      const app = new HHPlayApp(undefined, undefined, activity);
      const detail = await app.getHistoryDetail('1');
      expect(activity.getById).toHaveBeenCalledWith('1');
      expect(detail).toEqual(entry);
    });
    it('clearHistory 无 ActivityLogService 时应抛错', async () => {
      const app = new HHPlayApp();
      await expect(app.clearHistory()).rejects.toThrow('ActivityLogService not provided');
    });
    it('clearHistory 应代理到 ActivityLogService', async () => {
      const activity = createMockActivityLogService();
      const app = new HHPlayApp(undefined, undefined, activity);
      await app.clearHistory();
      expect(activity.clear).toHaveBeenCalledWith('play_hh');
    });
    it('getStats 无 ActivityLogService 时返回零值', async () => {
      const app = new HHPlayApp();
      const stats = await app.getStats();
      expect(stats).toEqual({ total: 0, wins: 0, losses: 0, today: 0 });
    });
    it('getStats 有 ActivityLogService 时应返回统计', async () => {
      const activity = createMockActivityLogService();
      (activity.stats as ReturnType<typeof vi.fn>).mockResolvedValue({
        total: 10, today: 2, thisWeek: 5, thisMonth: 8, byType: { play_hh: 7 },
      });
      const app = new HHPlayApp(undefined, undefined, activity);
      const stats = await app.getStats();
      expect(stats).toEqual({ total: 7, wins: 0, losses: 0, today: 2 });
    });
  });
});
