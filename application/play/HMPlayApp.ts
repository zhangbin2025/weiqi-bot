/**
 * @fileoverview 人机对弈应用编排器
 */
import type {
  IHMPlayService,
  IHMPlayState,
  IHMPlayCallbacks,
  IHMPlayConfig,
  IAnalysisResult,
  Difficulty,
} from '../../services/play/hm';
import type { HMPlayDraft } from '../../services/play/hm/HMPlayDraftTypes';
import type { IModelService, ModelConfig, ModelList } from '../../services/model';
import type { IActivityLogService, ActivityEntry } from '../../services/activity';
import type { RecorderHistoryManager } from '../recorder';
/** 对弈历史查询选项 */
export interface PlayHistoryOptions {
  keyword?: string;
  limit?: number;
  offset?: number;
}
/** 对弈历史条目 */
export interface PlayHistoryEntry {
  id: string;
  blackName: string;
  whiteName: string;
  moveCount: number;
  result?: string | undefined;
  playedAt: number;
}
/** 对弈统计 */
export interface PlayStats {
  total: number;
  wins: number;
  losses: number;
  today: number;
}
interface HMPlayActivityData extends Record<string, unknown> {
  sgf: string;
  blackName: string;
  whiteName: string;
  moveCount: number;
  winner?: 'black' | 'white' | undefined;
  reason?: 'resign' | 'double_pass' | undefined;
}
/** 人机对弈应用编排器 */
export class HMPlayApp {
  constructor(
    private readonly hmPlayService?: IHMPlayService,
    private readonly modelService?: IModelService,
    private readonly activityLogService?: IActivityLogService,
    private readonly historyManager?: RecorderHistoryManager,
  ) {}
  private requirePlay(): IHMPlayService {
    if (!this.hmPlayService) throw new Error('HMPlayService not provided');
    return this.hmPlayService;
  }
  private requireModel(): IModelService {
    if (!this.modelService) throw new Error('ModelService not provided');
    return this.modelService;
  }
  private requireActivity(): IActivityLogService {
    if (!this.activityLogService) throw new Error('ActivityLogService not provided');
    return this.activityLogService;
  }
  // ========== 对弈操作（代理 HMPlayService）==========
  newGame = (config: IHMPlayConfig): Promise<void> => this.requirePlay().newGame(config);
  playerMove = (x: number, y: number): Promise<boolean> => this.requirePlay().playerMove(x, y);
  playerPass = (): Promise<void> => this.requirePlay().playerPass();
  undo = (): Promise<boolean> => this.requirePlay().undo();
  analyze = (): Promise<IAnalysisResult> => this.requirePlay().analyze();
  resign = (): Promise<void> => this.requirePlay().resign();
  finalScore = (): Promise<{ winner: 'black' | 'white'; margin: number; sgfResult: string }> => 
    this.requirePlay().finalScore();
  getState = (): IHMPlayState => this.requirePlay().getState();
  setCallbacks = (callbacks: IHMPlayCallbacks): void => this.requirePlay().setCallbacks(callbacks);
  setDifficulty = (difficulty: Difficulty): void => this.requirePlay().setDifficulty(difficulty);
  setModel = (modelId: string): Promise<void> => this.requirePlay().setModel(modelId);
  cancelAiThinking = (): void => this.requirePlay().cancelAiThinking();
  isPlayerTurn = (): boolean => this.requirePlay().isPlayerTurn();
  isEnded = (): boolean => this.requirePlay().isEnded();
  canUndo = (): boolean => this.requirePlay().canUndo();
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
      const blackName = '玩家';
      const whiteName = 'AI';
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
    const moveHistory = state.moveHistory;
    const sgf = play.exportSgf();
    const blackName = '玩家';
    const whiteName = 'AI';
    const data: HMPlayActivityData = {
      sgf,
      blackName,
      whiteName,
      moveCount: moveHistory.length,
      winner: state.winner,
      reason: state.gameEnded ? 'resign' : undefined,
    };
    return this.activityLogService!.record(
      'play_hm',
      `人机对弈：${blackName} vs ${whiteName}`,
      data,
      ['对弈', '人机对弈'],
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
      type: 'play_hm',
      keyword: options?.keyword,
      limit: options?.limit ?? 20,
      offset: options?.offset,
    });
    return entries.map((e: ActivityEntry) => ({
      id: e.id,
      blackName: (e.data['blackName'] as string) ?? '',
      whiteName: (e.data['whiteName'] as string) ?? '',
      moveCount: (e.data['moveCount'] as number) ?? 0,
      result: e.data['result'] as string | undefined,
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
        type: 'play_hm',
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
    return this.requireActivity().clear('play_hm');
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
    return {
      total: stats.byType['play_hm'] ?? 0,
      wins: 0,
      losses: 0,
      today: stats.today,
    };
  }
  // ========== 草稿管理（代理 HMPlayService）==========
  /** 保存草稿 */
  saveDraft = (): Promise<void> => this.requirePlay().saveDraft();
  /** 加载草稿 */
  loadDraft = () => this.requirePlay().loadDraft();
  /** 清除草稿 */
  clearDraft = (): Promise<void> => this.requirePlay().clearDraft();
  /** 从草稿恢复 */
  restoreFromDraft = (draft: HMPlayDraft, modelUrl?: string) => this.requirePlay().restoreFromDraft(draft, modelUrl);
}
