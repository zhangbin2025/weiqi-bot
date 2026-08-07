/**
 * @fileoverview 真人对弈应用编排器
 */
import type { IHHPlayService, IHHPlayState, IHHPlayCallbacks, IRoomInfo, IPlayerInfo } from '../../services/play/hh';
import type { HHPlayDraft } from '../../services/play/hh/DraftTypes';
import type { PlayerColor } from '../../domain';
import type { IModelService, ModelConfig, ModelList } from '../../services/model';
import type { IActivityLogService, ActivityEntry } from '../../services/activity';
import type { RecorderHistoryManager } from '../recorder';
/** 对弈历史查询选项 */
export interface PlayHistoryOptions { keyword?: string; limit?: number; offset?: number }
/** 对弈历史条目 */
export interface PlayHistoryEntry {
  id: string; blackName: string; whiteName: string; moveCount: number; result?: string | undefined; playedAt: number;
}
/** 对弈统计 */
export interface PlayStats { total: number; wins: number; losses: number; today: number }
interface PlayActivityData extends Record<string, unknown> {
  sgf: string; blackName: string; whiteName: string; moveCount: number;
  winner?: 'black' | 'white' | 'draw' | undefined; reason?: 'resign' | 'timeout' | 'double_pass' | 'count' | undefined;
  scoreLead?: number | undefined; blackTerritory?: number | undefined; whiteTerritory?: number | undefined;
}
/** 真人对弈应用编排器 */
export class HHPlayApp {
  constructor(
    private readonly hhPlayService?: IHHPlayService,
    private readonly modelService?: IModelService,
    private readonly activityLogService?: IActivityLogService,
    private readonly historyManager?: RecorderHistoryManager,
  ) {}
  private requirePlay(): IHHPlayService {
    if (!this.hhPlayService) throw new Error('HHPlayService not provided');
    return this.hhPlayService;
  }
  private requireModel(): IModelService {
    if (!this.modelService) throw new Error('ModelService not provided');
    return this.modelService;
  }
  private requireActivity(): IActivityLogService {
    if (!this.activityLogService) throw new Error('ActivityLogService not provided');
    return this.activityLogService;
  }
  /** 数子计算胜负 */
  async countTerritory(komi: number): Promise<{
    blackTerritory: number;
    whiteTerritory: number;
    scoreLead: number;
    winner: 'black' | 'white' | 'draw';
  }> {
    return this.requirePlay().countTerritory(komi);
  }
  // ========== 对弈操作（代理 HHPlayService）==========
  createRoom = (name: string, config: Parameters<IHHPlayService['createRoom']>[1]) =>
    this.requirePlay().createRoom(name, config);
  joinRoom = (roomId: string, name: string) => this.requirePlay().joinRoom(roomId, name);
  move = (x: number, y: number) => this.requirePlay().move(x, y);
  canMove = (x: number, y: number) => this.requirePlay().canMove(x, y);
  pass = () => this.requirePlay().pass();
  requestUndo = () => this.requirePlay().requestUndo();
  respondUndo = (accept: boolean) => this.requirePlay().respondUndo(accept);
  resign = () => this.requirePlay().resign();
  reconnect = () => this.requirePlay().reconnect();
  leaveRoom = () => this.requirePlay().leaveRoom();
  getState = (): IHHPlayState => this.requirePlay().getState();
  setCallbacks = (callbacks: IHHPlayCallbacks) => this.requirePlay().setCallbacks(callbacks);
  getMoveHistory = (): Array<{ x: number; y: number; color: PlayerColor }> => this.requirePlay().getMoveHistory();
  exportSgf = (metadata?: { blackName?: string; whiteName?: string; result?: string }) =>
    this.requirePlay().exportSgf(metadata);
  /** 获取待确认的房间信息 */
  getRoomInfo = () => this.requirePlay().getRoomInfo();
  /** 确认加入房间 */
  confirmJoin = (name: string) => this.requirePlay().confirmJoin(name);
  /** 申请数子 */
  requestCount = () => this.requirePlay().requestCount();
  /** 回应数子请求 */
  respondCount = (agree: boolean) => this.requirePlay().respondCount(agree);
  /** 执行数子 */
  doCount = () => this.requirePlay().doCount();
  // ========== 模型管理（代理 ModelService）==========
  loadModels = (): Promise<ModelList> => this.requireModel().loadConfig();
  getModels = (): Promise<ModelConfig[]> => this.requireModel().getModels();
  switchModel = (id: string) => this.requireModel().switchModel(id);
  getCurrentModel = (): ModelConfig | null => this.requireModel().getCurrentModel();
  // ========== 历史管理（使用 ActivityLogService）==========
  async saveToHistory(result?: {
    winner: 'black' | 'white' | 'draw';
    reason: 'resign' | 'timeout' | 'double_pass' | 'count';
    scoreLead?: number;
    blackTerritory?: number;
    whiteTerritory?: number;
  }): Promise<string | null> {
    const play = this.requirePlay();
    // 优先使用 historyManager（归档机制）
    if (this.historyManager) {
      const state = play.getState();
      const sgf = play.exportSgf();
      const moveHistory = play.getMoveHistory();
      const blackName = state.me?.color === 'black' ? state.me.name : (state.opponent?.name ?? '黑方');
      const whiteName = state.me?.color === 'white' ? state.me.name : (state.opponent?.name ?? '白方');
      // 构造符合 historyManager 要求的 state 对象
      const stateForArchive = {
        moveHistory: moveHistory,
        board: { size: 19 },
      };
      return this.historyManager.saveToHistory(sgf, stateForArchive, { blackName, whiteName });
    }
    // Fallback 到 ActivityLogService
    // 如果 activityLogService 不存在，优雅降级（不保存对局记录）
    if (!this.activityLogService) {
      console.warn('[HHPlayApp] ActivityLogService 未提供，跳过保存对局记录');
      return null;
    }
    const state = play.getState();
    const sgf = play.exportSgf();
    const moveHistory = play.getMoveHistory();
    const blackName = state.me?.color === 'black' ? state.me.name : (state.opponent?.name ?? '黑方');
    const whiteName = state.me?.color === 'white' ? state.me.name : (state.opponent?.name ?? '白方');
    const data: PlayActivityData = {
      sgf, blackName, whiteName, moveCount: moveHistory.length,
      winner: result?.winner, reason: result?.reason,
      scoreLead: result?.scoreLead, blackTerritory: result?.blackTerritory, whiteTerritory: result?.whiteTerritory,
    };
    return this.activityLogService.record('play_hh', `对弈：${blackName} vs ${whiteName}`, data, ['对弈', '真人对弈']);
  }
  async queryHistory(options?: PlayHistoryOptions): Promise<PlayHistoryEntry[]> {
    // 优先使用 historyManager
    if (this.historyManager) {
      const entries = await this.historyManager.queryHistory(options);
      return entries.map(e => ({
        id: e.id,
        blackName: e.blackName,
        whiteName: e.whiteName,
        moveCount: e.moveCount,
        playedAt: e.createdAt,
      }));
    }
    // Fallback 到 ActivityLogService
    if (!this.activityLogService) return [];
    const entries = await this.activityLogService.query({
      type: 'play_hh', keyword: options?.keyword, limit: options?.limit ?? 20, offset: options?.offset,
    });
    return entries.map((e: ActivityEntry) => ({
      id: e.id, blackName: (e.data['blackName'] as string) ?? '', whiteName: (e.data['whiteName'] as string) ?? '',
      moveCount: (e.data['moveCount'] as number) ?? 0, result: e.data['result'] as string | undefined, playedAt: e.createdAt,
    }));
  }
  async getHistoryDetail(id: string): Promise<ActivityEntry | null> {
    // 优先使用 historyManager
    if (this.historyManager) {
      const detail = await this.historyManager.getHistoryDetail(id);
      if (!detail) return null;
      // 转换为 ActivityEntry 格式（保持向后兼容）
      return {
        id: detail.id,
        type: 'play_hh',
        title: `${detail.blackName} vs ${detail.whiteName}`,
        data: {
          sgf: detail.sgf,
          blackName: detail.blackName,
          whiteName: detail.whiteName,
          moveCount: detail.moveCount,
          size: detail.size,
        },
        createdAt: detail.createdAt,
      };
    }
    // Fallback 到 ActivityLogService
    return this.activityLogService ? this.activityLogService.getById(id) : Promise.resolve(null);
  }
  async clearHistory(): Promise<void> {
    // 优先使用 historyManager
    if (this.historyManager) {
      return this.historyManager.clearHistory();
    }
    // Fallback 到 ActivityLogService
    return this.requireActivity().clear('play_hh');
  }
  async getStats(): Promise<PlayStats> {
    // 优先使用 historyManager
    if (this.historyManager) {
      const stats = await this.historyManager.getStats();
      return { total: stats.total, wins: 0, losses: 0, today: stats.today };
    }
    // Fallback 到 ActivityLogService
    if (!this.activityLogService) return { total: 0, wins: 0, losses: 0, today: 0 };
    const stats = await this.activityLogService.stats();
    return { total: stats.byType['play_hh'] ?? 0, wins: 0, losses: 0, today: stats.today };
  }
  // ========== 草稿管理（代理 HHPlayService）==========
  /** 从草稿恢复对局 */
  restoreFromDraft = (draft: HHPlayDraft): Promise<void> => this.requirePlay().restoreFromDraft(draft);
  /** 加载草稿 */
  loadDraft = (): Promise<HHPlayDraft | null> => this.requirePlay().loadDraft();
  /** 保存草稿 */
  saveDraft = (draft?: HHPlayDraft): Promise<void> => {
    if (draft) {
      // 如果提供了草稿数据，直接保存
      return this.requirePlay().saveDraftWithData(draft);
    }
    return this.requirePlay().saveDraft();
  };
  /** 清除草稿 */
  clearDraft = (): Promise<void> => this.requirePlay().clearDraft();
  /** 断开连接 */
  disconnect = (): Promise<void> => this.requirePlay().disconnect();
}