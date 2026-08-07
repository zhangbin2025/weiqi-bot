/**
 * @fileoverview 对手断线处理器 - 处理对手断线和重连逻辑
 * @description 封装对手断线、重连、超时获胜、放弃等待等逻辑
 */
import type { HHPlayApp } from '../../../../../../application/play';
import type { HHDialogRenderer } from '../HHDialogRenderer';
import type { PlayerColor } from '../../../../../core/types';
/** 对手处理器配置 */
export interface HHOpponentHandlerConfig {
  hhPlayApp: HHPlayApp;
  dialogRenderer: HHDialogRenderer;
  myColor: PlayerColor | undefined;
}
/**
 * 对手断线处理器
 * @description 负责处理对手断线、重连等场景
 */
export class HHOpponentHandler {
  private hhPlayApp: HHPlayApp;
  private dialogRenderer: HHDialogRenderer;
  private myColor: PlayerColor | undefined;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectCountdownTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectCountdown: number = 0;
  constructor(config: HHOpponentHandlerConfig) {
    this.hhPlayApp = config.hhPlayApp;
    this.dialogRenderer = config.dialogRenderer;
    this.myColor = config.myColor;
  }
  /**
   * 更新我的颜色
   */
  setMyColor(color: PlayerColor | undefined): void {
    this.myColor = color;
  }
  /**
   * 处理对手断线
   * @param onShowDialog 显示等待重连对话框的回调
   */
  handleDisconnected(onShowDialog: () => void): void {
    // 清除旧的定时器
    this.clearTimers();
    // 5秒后显示等待重连对话框
    this.reconnectTimeout = setTimeout(() => {
      const state = this.hhPlayApp.getState();
      if (!state.gameEnded && state.inGame) {
        onShowDialog();
      }
    }, 5000);
  }
  /**
   * 显示等待重连对话框
   * @param timeout 超时时间（秒）
   * @param onTimeout 超时回调
   */
  showWaitingDialog(timeout: number, onTimeout: () => void): void {
    this.reconnectCountdown = timeout;
    this.dialogRenderer.showWaitingReconnectDialog(
      timeout,
      () => this.giveUpWaiting()
    );
    // 启动倒计时
    this.reconnectCountdownTimer = setInterval(() => {
      this.reconnectCountdown--;
      this.dialogRenderer.updateReconnectCountdown(this.reconnectCountdown);
      if (this.reconnectCountdown <= 0) {
        this.clearTimers();
        onTimeout();
      }
    }, 1000);
  }
  /**
   * 处理对手重连成功
   */
  handleReconnected(): void {
    this.clearTimers();
    this.dialogRenderer.close();
  }
  /**
   * 处理超时获胜
   */
  async handleTimeoutWin(onGameEnd: (winner: PlayerColor, reason: string) => void): Promise<void> {
    // 清除定时器
    this.clearTimers();
    // 断开连接
    try {
      await this.hhPlayApp.disconnect();
    } catch (error) {
      console.error('[HHOpponentHandler] 断开连接失败', error);
    }
    // 清除草稿
    try {
      await this.hhPlayApp.clearDraft();
    } catch (error) {
      console.error('[HHOpponentHandler] 清除草稿失败', error);
    }
    // 结束对局，本方获胜
    if (this.myColor) {
      onGameEnd(this.myColor, 'timeout');
    }
  }
  /**
   * 放弃等待
   */
  private async giveUpWaiting(): Promise<void> {
    // 先标记草稿为已放弃
    try {
      const draft = await this.hhPlayApp.loadDraft();
      if (draft) {
        draft.abandoned = true;
        await this.hhPlayApp.saveDraft(draft);
      }
    } catch (error) {
      console.error('[HHOpponentHandler] 标记草稿失败', error);
    }
    // 清除定时器
    this.clearTimers();
    // 断开所有连接
    try {
      await this.hhPlayApp.disconnect();
    } catch (error) {
      console.error('[HHOpponentHandler] 断开连接失败', error);
    }
    // 清除草稿
    try {
      await this.hhPlayApp.clearDraft();
    } catch (error) {
      console.error('[HHOpponentHandler] 清除草稿失败', error);
    }
    // 关闭对话框，跳转到 play/index.html
    this.dialogRenderer.close();
    window.location.href = '/play/index.html';
  }
  /**
   * 清除定时器
   */
  private clearTimers(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.reconnectCountdownTimer) {
      clearInterval(this.reconnectCountdownTimer);
      this.reconnectCountdownTimer = null;
    }
  }
  /**
   * 销毁
   */
  destroy(): void {
    this.clearTimers();
  }
}
