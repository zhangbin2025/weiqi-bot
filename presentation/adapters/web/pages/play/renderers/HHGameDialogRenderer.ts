/**
 * @fileoverview 游戏对话框渲染器 - 渲染游戏相关对话框
 * @description 负责渲染数子请求、草稿恢复等对话框
 */
import type { HHPlayDraft } from '../../../../../../services/play/hh/DraftTypes';
/**
 * 游戏对话框渲染器
 * @description 封装游戏相关对话框的 HTML 渲染逻辑
 */
export class HHGameDialogRenderer {
  private container: HTMLElement;
  constructor(container: HTMLElement) {
    this.container = container;
  }
  /**
   * 显示草稿恢复对话框
   */
  showDraftRecoveryDialog(
    draft: HHPlayDraft,
    onReconnect: () => void,
    onAbandon: () => void
  ): void {
    const moveCount = this.countMovesFromSGF(draft.sgf);
    this.container.innerHTML = `
      <div class="dialog-overlay show">
        <div class="dialog">
          <div class="dialog-title">恢复对局</div>
          <div style="text-align:center;margin-bottom:16px;color:#666">
            检测到未完成的对局
          </div>
          <div style="margin-bottom:12px;text-align:center">
            <div style="font-size:13px;color:#666">房间 ${draft.roomId}</div>
            <div style="font-size:14px">
              ${draft.myName} (${draft.myColor === 'black' ? '执黑' : '执白'})
            </div>
            <div style="font-size:13px;color:#999">${moveCount} 手</div>
          </div>
          <button class="btn btn-primary" id="reconnectBtn">重新连接</button>
          <button class="btn btn-secondary" id="abandonBtn">放弃对局</button>
        </div>
      </div>
    `;
    document.getElementById('reconnectBtn')?.addEventListener('click', onReconnect);
    document.getElementById('abandonBtn')?.addEventListener('click', onAbandon);
  }
  /**
   * 显示数子请求对话框
   */
  showCountRequestDialog(
    from: string,
    onAgree: () => void,
    onRefuse: () => void
  ): void {
    this.container.innerHTML = `
      <div class="dialog-overlay show">
        <div class="dialog">
          <div class="dialog-title">数子请求</div>
          <div style="text-align:center;margin-bottom:16px">${from} 申请数子</div>
          <div style="display:flex;gap:12px;justify-content:center">
            <button class="btn btn-primary" id="agreeCountBtn">同意</button>
            <button class="btn btn-secondary" id="refuseCountBtn">拒绝</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('agreeCountBtn')?.addEventListener('click', onAgree);
    document.getElementById('refuseCountBtn')?.addEventListener('click', onRefuse);
  }
  /**
   * 显示悔棋请求对话框
   */
  showUndoRequestDialog(
    from: string,
    onAgree: () => void,
    onRefuse: () => void
  ): void {
    this.container.innerHTML = `
      <div class="dialog-overlay show">
        <div class="dialog">
          <div class="dialog-title">悔棋请求</div>
          <div style="text-align:center;margin-bottom:16px">${from} 申请悔棋</div>
          <div style="display:flex;gap:12px;justify-content:center">
            <button class="btn btn-primary" id="agreeUndoBtn">同意</button>
            <button class="btn btn-secondary" id="refuseUndoBtn">拒绝</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('agreeUndoBtn')?.addEventListener('click', onAgree);
    document.getElementById('refuseUndoBtn')?.addEventListener('click', onRefuse);
  }
  /**
   * 从 SGF 统计手数
   */
  private countMovesFromSGF(sgf: string): number {
    const blackMoves = (sgf.match(/B\[/g) || []).length;
    const whiteMoves = (sgf.match(/W\[/g) || []).length;
    return blackMoves + whiteMoves;
  }
}
