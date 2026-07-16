/**
 * @fileoverview 真人对弈对话框渲染器 - 主渲染器
 * @description 组合各个子渲染器，提供统一的对话框渲染接口
 */
import type { PlayerColor } from '../../../../core/types';
import type { HHPlayDraft } from '../../../../../services/play/hh/DraftTypes';
import { HHRoomDialogRenderer } from './renderers/HHRoomDialogRenderer';
import { HHWaitingDialogRenderer } from './renderers/HHWaitingDialogRenderer';
import { HHGameDialogRenderer } from './renderers/HHGameDialogRenderer';
/**
 * 对话框渲染器
 * @description 组合各个子渲染器，提供统一的对话框渲染接口
 */
export class HHDialogRenderer {
  private container: HTMLElement;
  private roomRenderer: HHRoomDialogRenderer;
  private waitingRenderer: HHWaitingDialogRenderer;
  private gameRenderer: HHGameDialogRenderer;
  constructor(containerId: string = 'dialogContainer') {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Dialog container #${containerId} not found`);
    }
    this.container = container;
    // 初始化子渲染器
    this.roomRenderer = new HHRoomDialogRenderer(this.container);
    this.waitingRenderer = new HHWaitingDialogRenderer(this.container);
    this.gameRenderer = new HHGameDialogRenderer(this.container);
  }
  // ========== 房间相关对话框 ==========
  showStartDialog(onCreate: () => void, onJoin: () => void): void {
    this.roomRenderer.showStartDialog(onCreate, onJoin);
  }
  showCreateDialog(
    defaultName: string,
    onConfirm: (name: string, color: 'black' | 'white' | 'random', handicap: number, timeLimit: number) => void,
    onCancel: () => void
  ): void {
    this.roomRenderer.showCreateDialog(defaultName, onConfirm, onCancel);
  }
  showJoinDialog(
    defaultName: string,
    onConfirm: (roomId: string, name: string) => void,
    onCancel: () => void
  ): void {
    this.roomRenderer.showJoinDialog(defaultName, onConfirm, onCancel);
  }
  showJoinConfirmDialog(
    roomInfo: {
      creatorName: string;
      creatorColor: 'black' | 'white';
      handicap: number;
      timeLimit: number;
    },
    defaultName: string,
    onConfirm: (name: string) => void,
    onCancel: () => void
  ): void {
    this.roomRenderer.showJoinConfirmDialog(roomInfo, defaultName, onConfirm, onCancel);
  }
  // ========== 等待相关对话框 ==========
  showWaitingDialog(
    roomId: string,
    myColor: PlayerColor,
    handicap: number,
    timeLimit: number,
    onCancel: () => void
  ): void {
    this.waitingRenderer.showWaitingDialog(roomId, myColor, handicap, timeLimit, onCancel);
  }
  showWaitingReconnectDialog(timeout: number, onGiveUp: () => void): void {
    this.waitingRenderer.showWaitingReconnectDialog(timeout, onGiveUp);
  }
  updateReconnectCountdown(seconds: number): void {
    this.waitingRenderer.updateReconnectCountdown(seconds);
  }
  // ========== 游戏相关对话框 ==========
  showDraftRecoveryDialog(
    draft: HHPlayDraft,
    onReconnect: () => void,
    onAbandon: () => void
  ): void {
    this.gameRenderer.showDraftRecoveryDialog(draft, onReconnect, onAbandon);
  }
  showCountRequestDialog(from: string, onAgree: () => void, onRefuse: () => void): void {
    this.gameRenderer.showCountRequestDialog(from, onAgree, onRefuse);
  }
  showUndoRequestDialog(from: string, onAgree: () => void, onRefuse: () => void): void {
    this.gameRenderer.showUndoRequestDialog(from, onAgree, onRefuse);
  }
  // ========== 通用方法 ==========
  close(): void {
    this.container.innerHTML = '';
  }
}
