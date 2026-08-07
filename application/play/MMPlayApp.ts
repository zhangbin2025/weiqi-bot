/**
 * @fileoverview AI 自对弈应用编排器
 */
import type { IMMPlayService, IMMPlayCallbacks } from '../../services/play/mm/IMMPlayService';
import type { IMMPlayState, IMMPlayConfig } from '../../services/play/mm/types';
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
interface MMPlayActivityData extends Record<string, unknown> {
  sgf: string; modelId: string; moveCount: number;
  winner?: 'black' | 'white' | 'draw' | undefined; blackScore?: number | undefined; whiteScore?: number | undefined;
}
/** AI 自对弈应用编排器 */
export class MMPlayApp {
  constructor(
    private readonly mmPlayService?: IMMPlayService,
    private readonly modelService?: IModelService,
    private readonly activityLogService?: IActivityLogService,
    private readonly historyManager?: RecorderHistoryManager,
  ) {}
  private requirePlay(): IMMPlayService {
    if (!this.mmPlayService) throw new Error('MMPlayService not provided');
    return this.mmPlayService;
  }
  private requireModel(): IModelService {
    if (!this.modelService) throw new Error('ModelService not provided');
    return this.modelService;
  }
  private requireActivity(): IActivityLogService {
    if (!this.activityLogService) throw new Error('ActivityLogService not provided');
    return this.activityLogService;
  }
  // ========== 自对弈操作（代理 MMPlayService）==========
  setup = (config: IMMPlayConfig, modelUrl?: string, onProgress?: (loaded: number, total: number, progress: number) => void): Promise<void> => 
    this.requirePlay().setup(config, modelUrl, onProgress);
  start = (): Promise<void> => this.requirePlay().start();
  pause = (): void => this.requirePlay().pause();
  resume = (): void => this.requirePlay().resume();
  stop = (): void => this.requirePlay().stop();
  step = (): Promise<boolean> => this.requirePlay().step();
  getState = (): IMMPlayState => this.requirePlay().getState();
  setCallbacks = (callbacks: IMMPlayCallbacks): void => this.requirePlay().setCallbacks(callbacks);
  // ========== 模型管理（代理 ModelService）==========
  loadModels = (): Promise<ModelList> => this.requireModel().loadConfig();
  getModels = (): Promise<ModelConfig[]> => this.requireModel().getModels();
  switchModel = (id: string, onProgress?: (loaded: number, total: number, progress: number) => void): Promise<void> => 
    this.requireModel().switchModel(id, onProgress);
  getCurrentModel = (): ModelConfig | null => this.requireModel().getCurrentModel();
  // ========== 历史管理（优先使用 historyManager，fallback 到 ActivityLogService）==========
  async saveToHistory(): Promise<string | null> {
    // 优先使用 historyManager（归档机制）
    if (this.historyManager) {
      const play = this.requirePlay();
      const state = play.getState();
      const sgf = play.exportSgf();
      const model = this.modelService?.getCurrentModel();
      const blackName = `AI-${model?.id ?? '黑方'}`;
      const whiteName = `AI-${model?.id ?? '白方'}`;
      // 构造符合 historyManager 要求的 state 对象
      const stateForArchive = {
        moveHistory: state.moveHistory,
        board: { size: state.board.length },
      };
      return this.historyManager.saveToHistory(sgf, stateForArchive, { blackName, whiteName });
    }
    // Fallback 到 ActivityLogService
    const play = this.requirePlay();
    this.requireActivity();
    const state = play.getState();
    const sgf = play.exportSgf();
    const model = this.modelService?.getCurrentModel();
    const winner = state.gameEnded
      ? (state.blackScore != null && state.whiteScore != null
        ? (state.blackScore > state.whiteScore ? 'black' : state.whiteScore > state.blackScore ? 'white' : 'draw')
        : undefined)
      : undefined;
    const data: MMPlayActivityData = {
      sgf, modelId: model?.id ?? 'unknown', moveCount: state.moveHistory.length,
      winner, blackScore: state.blackScore, whiteScore: state.whiteScore,
    };
    return this.activityLogService!.record(
      'play_mm', `AI 自对弈：${model?.id ?? 'unknown'}`, data, ['对弈', 'AI自对弈'],
    );
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
      type: 'play_mm', keyword: options?.keyword, limit: options?.limit ?? 20, offset: options?.offset,
    });
    return entries.map((e: ActivityEntry) => ({
      id: e.id,
      blackName: `AI(${(e.data['modelId'] as string) ?? 'unknown'})`,
      whiteName: `AI(${(e.data['modelId'] as string) ?? 'unknown'})`,
      moveCount: (e.data['moveCount'] as number) ?? 0,
      result: e.data['winner'] as string | undefined,
      playedAt: e.createdAt,
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
        type: 'play_mm',
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
    return this.requireActivity().clear('play_mm');
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
    return { total: stats.byType['play_mm'] ?? 0, wins: 0, losses: 0, today: stats.today };
  }
  // ========== 草稿管理（代理 MMPlayService）==========
  /** 保存草稿 */
  saveDraft = (): Promise<void> => this.requirePlay().saveDraft();
  /** 加载草稿 */
  loadDraft = () => this.requirePlay().loadDraft();
  /** 清除草稿 */
  clearDraft = (): Promise<void> => this.requirePlay().clearDraft();
  /** 从草稿恢复 */
  restoreFromDraft = (draft: any) => this.requirePlay().restoreFromDraft(draft);
  // ========== SGF 导出 ==========
  exportSgf = (): string => this.requirePlay().exportSgf();
  // ========== 形势判断和数目 ==========
  /**
   * 形势判断
   * @returns 黑方胜率和目差
   */
  analyzePosition = (): Promise<{ winRate: number; scoreLead: number }> => 
    this.requirePlay().analyzePosition();
  /**
   * AI 数目（对局结束时判断胜负）
   * @returns 胜负结果
   */
  finalScore = (): Promise<{ winner: 'black' | 'white'; margin: number; sgfResult: string }> => 
    this.requirePlay().finalScore();
}
