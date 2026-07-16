/**
 * @fileoverview 等待对话框渲染器 - 渲染等待相关对话框
 * @description 负责渲染等待对手、等待重连等对话框
 */
import type { PlayerColor } from '../../../../../core/types';
/**
 * 等待对话框渲染器
 * @description 封装等待相关对话框的 HTML 渲染逻辑
 */
export class HHWaitingDialogRenderer {
  private container: HTMLElement;
  constructor(container: HTMLElement) {
    this.container = container;
  }
  /**
   * 显示等待对手对话框
   */
  showWaitingDialog(
    roomId: string,
    myColor: PlayerColor,
    handicap: number,
    timeLimit: number,
    onCancel: () => void
  ): void {
    const handicapText = handicap === 0 ? '不让子' : `让 ${handicap} 子`;
    const myColorText = myColor === 'black' ? '你执黑' : '你执白';
    this.container.innerHTML = `
      <div class="dialog-overlay show">
        <div class="dialog">
          <div class="dialog-title">等待对手加入</div>
          <div class="room-display">
            <div class="label">房间ID</div>
            <div class="value">${roomId}</div>
          </div>
          <div style="text-align:center;margin-bottom:12px">
            <button class="btn-small" id="copyRoomBtn">复制房间ID</button>
          </div>
          <div style="margin-bottom:12px">
            <div style="font-size:13px;color:#666;margin-bottom:8px">对局条件</div>
            <ul class="condition-list">
              <li>${myColorText}</li>
              <li>${handicapText}</li>
              <li>每方 ${timeLimit} 分钟</li>
            </ul>
          </div>
          <div class="waiting"><span class="waiting-dots">等待对手</span></div>
          <button class="btn btn-secondary" id="cancelWaitingBtn">取消</button>
        </div>
      </div>
    `;
    document.getElementById('copyRoomBtn')?.addEventListener('click', () => {
      navigator.clipboard.writeText(roomId).then(() => {
        const btn = document.getElementById('copyRoomBtn');
        if (btn) {
          btn.textContent = '已复制';
          setTimeout(() => { btn.textContent = '复制房间ID'; }, 2000);
        }
      });
    });
    document.getElementById('cancelWaitingBtn')?.addEventListener('click', onCancel);
  }
  /**
   * 显示等待重连对话框
   */
  showWaitingReconnectDialog(
    timeout: number,
    onGiveUp: () => void
  ): void {
    this.container.innerHTML = `
      <div class="dialog-overlay show">
        <div class="dialog">
          <div class="dialog-title">对手已离开</div>
          <div style="margin-bottom:16px;text-align:center;color:#666">等待对手恢复连接...</div>
          <div id="reconnectCountdown" style="margin-bottom:16px;text-align:center;font-size:13px;color:#999">${timeout} 秒后自动结束</div>
          <button class="btn btn-primary" id="giveUpWaitingBtn">放弃等待</button>
        </div>
      </div>
    `;
    document.getElementById('giveUpWaitingBtn')?.addEventListener('click', onGiveUp);
  }
  /**
   * 更新倒计时显示
   */
  updateReconnectCountdown(seconds: number): void {
    const el = document.getElementById('reconnectCountdown');
    if (el && seconds > 0) {
      el.textContent = `${seconds} 秒后自动结束`;
    }
  }
}
