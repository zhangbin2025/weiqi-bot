/**
 * @fileoverview 草稿控制器 - 处理草稿恢复逻辑
 * @description 封装草稿加载、恢复、清除等逻辑
 */
import type { HHPlayApp } from '../../../../../../application/play';
import type { HHDialogRenderer } from '../HHDialogRenderer';
import type { IToast } from '../../../../../core/interfaces';
import type { HHPlayDraft } from '../../../../../../services/play/hh/DraftTypes';
/** 草稿控制器配置 */
export interface HHDraftControllerConfig {
  hhPlayApp: HHPlayApp;
  dialogRenderer: HHDialogRenderer;
  toast: IToast;
}
/** 恢复状态 */
export interface ReconnectedState {
  roomId: string;
  myName: string;
  myColor: 'black' | 'white';
  opponentName: string;
  timeLimit: number;
  blackTime: number;
  whiteTime: number;
}
/**
 * 草稿控制器
 * @description 负责草稿的加载、恢复、清除等操作
 */
export class HHDraftController {
  private hhPlayApp: HHPlayApp;
  private dialogRenderer: HHDialogRenderer;
  private toast: IToast;
  constructor(config: HHDraftControllerConfig) {
    this.hhPlayApp = config.hhPlayApp;
    this.dialogRenderer = config.dialogRenderer;
    this.toast = config.toast;
  }
  /**
   * 加载草稿
   */
  async loadDraft(): Promise<HHPlayDraft | null> {
    return await this.hhPlayApp.loadDraft();
  }
  /**
   * 显示草稿恢复对话框
   */
  showDraftRecoveryDialog(
    draft: HHPlayDraft,
    onReconnect: (state: ReconnectedState) => void,
    onAbandon: () => void
  ): void {
    this.dialogRenderer.showDraftRecoveryDialog(
      draft,
      () => this.reconnectGame(draft).then(onReconnect),
      () => this.clearSavedGame().then(onAbandon)
    );
  }
  /**
   * 恢复对局
   */
  private async reconnectGame(draft: HHPlayDraft): Promise<ReconnectedState> {
    try {
      // 计算断线期间消耗的时间
      let blackTime = draft.blackTime;
      let whiteTime = draft.whiteTime;
      if (draft.lastMoveTimestamp > 0) {
        const elapsed = Math.floor((Date.now() - draft.lastMoveTimestamp) / 1000);
        if (draft.currentPlayer === 'black') {
          blackTime = Math.max(0, draft.blackTime - elapsed);
        } else {
          whiteTime = Math.max(0, draft.whiteTime - elapsed);
        }
      }
      // 关闭对话框
      this.dialogRenderer.close();
      // 从草稿恢复对局（包括重新连接）
      await this.hhPlayApp.restoreFromDraft(draft);
      return {
        roomId: draft.roomId,
        myName: draft.myName,
        myColor: draft.myColor,
        opponentName: draft.opponentName,
        timeLimit: draft.timeLimit,
        blackTime,
        whiteTime,
      };
    } catch (error) {
      console.error('恢复对局失败', error as Error);
      this.toast.error('恢复对局失败，请重试');
      await this.clearSavedGame();
      throw error;
    }
  }
  /**
   * 放弃对局
   */
  async clearSavedGame(): Promise<void> {
    await this.hhPlayApp.clearDraft();
    this.dialogRenderer.close();
  }
}
