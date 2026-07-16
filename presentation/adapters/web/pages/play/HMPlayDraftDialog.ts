/**
 * 人机对弈草稿恢复对话框
 * @module presentation/pages/play/HMPlayDraftDialog
 */
import type { HMPlayApp } from '../../../../../application/play';
import type { HMPlayDraft } from '../../../../../services/play/hm/HMPlayDraftTypes';
export interface HMPlayDraftDialogConfig {
  hmPlayApp: HMPlayApp;
  onRestore: (moveCount: number, playerColor: string) => void;
  onNewGame: () => void;
}
/**
 * 草稿恢复对话框管理器
 */
export class HMPlayDraftDialog {
  private hmPlayApp: HMPlayApp;
  private onRestore: (moveCount: number, playerColor: string) => void;
  private onNewGame: () => void;
  constructor(config: HMPlayDraftDialogConfig) {
    this.hmPlayApp = config.hmPlayApp;
    this.onRestore = config.onRestore;
    this.onNewGame = config.onNewGame;
  }
  /**
   * 显示草稿恢复对话框
   */
  async show(draft: HMPlayDraft): Promise<void> {
    const container = document.getElementById('dialogContainer');
    if (!container) return;
    container.innerHTML = `
      <div class="dialog-overlay">
        <div class="dialog">
          <div class="dialog-title">恢复对局</div>
          <div style="text-align: center; margin-bottom: 20px; color: #666;">
            发现未完成的对局（手数: ${draft.moveCount ?? 0}），是否继续？
          </div>
          <div class="btn-group">
            <button class="btn btn-primary" id="restoreDraftBtn">继续对局</button>
            <button class="btn btn-secondary" id="newGameBtn">开始新局</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('restoreDraftBtn')?.addEventListener('click', async () => {
      container.innerHTML = '';
      await this.restoreFromDraft(draft);
    });
    document.getElementById('newGameBtn')?.addEventListener('click', async () => {
      container.innerHTML = '';
      await this.hmPlayApp.clearDraft();
      this.onNewGame();
    });
  }
  /**
   * 从草稿恢复
   */
  private async restoreFromDraft(draft: HMPlayDraft): Promise<void> {
    try {
      await this.hmPlayApp.restoreFromDraft(draft);
      const moveCount = draft.moveCount ?? 0;
      const playerColor = draft.playerColor ?? 'black';
      this.onRestore(moveCount, playerColor);
    } catch (error) {
      console.error('恢复草稿失败', error as Error);
    }
  }
}
