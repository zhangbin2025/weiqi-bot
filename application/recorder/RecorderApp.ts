/**
 * 记谱应用编排器
 * @description Application 层编排器，组合 RecorderService、ExportService、HistoryManager 完成记谱业务流程
 */
import type { IRecorderService } from '../../services/recorder';
import type { IExportService } from '../../services/export';
import type { IGameConfig, IGameState, IMoveResult } from '../../domain/game';
import type { IGameMetadata, OnUpdateCallback } from '../../services/recorder/types';
import type { ExportResult } from '../../infrastructure/utils/export';
import type { IAudioPlayer, SoundType } from '../../infrastructure/audio';
import type {
  RecorderHistoryOptions,
  RecorderHistoryEntry,
  RecorderStats,
  RecorderHistoryDetail,
} from './types';
import { RecorderHistoryManager } from './RecorderHistoryManager';
/**
 * 记谱应用编排器
 * @description 组合 RecorderService、ExportService、HistoryManager 完成记谱业务流程
 */
export class RecorderApp {
  private historyManager: RecorderHistoryManager;
  constructor(
    private readonly recorderService: IRecorderService,
    private readonly exportService: IExportService,
    historyManager: RecorderHistoryManager,
    private readonly audioPlayer?: IAudioPlayer,
  ) {
    this.historyManager = historyManager;
    // 每次 state 变化时自动保存草稿
    this.recorderService.setOnUpdate((state: IGameState) => {
      this.saveDraft().catch((err) => {
        console.warn('自动保存草稿失败', err);
      });
    });
  }
  // ===== 记谱操作 =====
  placeStone(x: number, y: number): IMoveResult {
    return this.recorderService.placeStone(x, y);
  }
  pass(): void {
    this.recorderService.pass();
  }
  undo(): boolean {
    return this.recorderService.undo();
  }
  newGame(config?: IGameConfig): void {
    this.recorderService.newGame(config);
  }
  getState(): IGameState {
    return this.recorderService.getState();
  }
  generateSGF(metadata?: IGameMetadata): string {
    return this.recorderService.generateSGF(metadata);
  }
  /**
   * 下载 SGF
   */
  async downloadSGF(metadata?: IGameMetadata): Promise<ExportResult> {
    const sgf = this.generateSGF(metadata);
    const gameName = `${metadata?.blackName || '黑'}_vs_${metadata?.whiteName || '白'}`;
    return this.exportService.exportSGF(sgf, gameName);
  }
  // ===== 草稿管理 =====
  async saveDraft(): Promise<void> {
    return this.recorderService.saveDraft();
  }
  async loadDraft(): Promise<void> {
    return this.recorderService.loadDraft();
  }
  async clearDraft(): Promise<void> {
    return this.recorderService.clearDraft();
  }
  // ===== 历史管理（委托给 HistoryManager） =====
  /**
   * 保存到历史
   * @description 通过 HistoryManager 归档 SGF 并存储到收藏
   * @returns 收藏 ID
   */
  async saveToHistory(metadata?: IGameMetadata): Promise<string | null> {
    const state = this.recorderService.getState();
    const sgf = this.recorderService.generateSGF(metadata);
    return this.historyManager.saveToHistory(
      sgf,
      { moveHistory: state.moveHistory, board: state.board },
      metadata,
    );
  }
  /** 查询棋谱历史 */
  async queryHistory(options?: RecorderHistoryOptions): Promise<RecorderHistoryEntry[]> {
    return this.historyManager.queryHistory(options);
  }
  /** 获取历史棋谱详情 */
  async getHistoryDetail(id: string): Promise<RecorderHistoryDetail | null> {
    return this.historyManager.getHistoryDetail(id);
  }
  /** 清空历史 */
  async clearHistory(): Promise<void> {
    return this.historyManager.clearHistory();
  }
  /** 获取统计 */
  async getStats(): Promise<RecorderStats> {
    return this.historyManager.getStats();
  }
  // ===== 回调设置 =====
  setOnUpdate(callback: OnUpdateCallback): void {
    this.recorderService.setOnUpdate(callback);
  }
  // ===== 音效 =====
  /** 播放音效 */
  playSound(type: SoundType): void {
    if (!this.audioPlayer) return;
    this.audioPlayer.play(type).catch(() => {
      console.warn('音效播放失败', { type });
    });
  }
}
