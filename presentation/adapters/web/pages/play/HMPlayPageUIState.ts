/**
 * 人机对弈页面 UI 状态管理
 * @module presentation/pages/play/HMPlayPageUIState
 */
import type { Position } from '../../../../core/types';
/**
 * UI 状态管理器
 * 负责管理选中位置、工具栏按钮切换、确认按钮控制
 */
export class HMPlayPageUIState {
  private selectedPosition: Position | null = null;
  private hasDraft: boolean = false;  // 是否有未完成的对局草稿
  /** 获取选中位置 */
  getSelectedPosition(): Position | null {
    return this.selectedPosition;
  }
  /** 设置选中位置 */
  setSelectedPosition(pos: Position | null): void {
    this.selectedPosition = pos;
  }
  /** 是否有未完成的对局草稿 */
  hasDraftToRecover(): boolean {
    return this.hasDraft;
  }
  /** 设置是否有草稿 */
  setHasDraft(hasDraft: boolean): void {
    this.hasDraft = hasDraft;
  }
  /** 显示确认按钮 */
  showConfirmButton(): void {
    const confirmBtn = document.getElementById('confirmBtn');
    const situationBtn = document.getElementById('situationBtn');
    const statsInfo = document.getElementById('statsInfo');
    const toolbar = document.querySelector('.toolbar') as HTMLElement;
    if (confirmBtn) {
      confirmBtn.style.display = 'flex';
    }
    if (situationBtn) situationBtn.style.display = 'none';
    if (statsInfo) statsInfo.style.display = 'none';
    // 改变工具栏布局为居中
    if (toolbar) {
      toolbar.style.justifyContent = 'center';
    }
  }
  /** 隐藏确认按钮 */
  hideConfirmButton(): void {
    const confirmBtn = document.getElementById('confirmBtn');
    const situationBtn = document.getElementById('situationBtn');
    const statsInfo = document.getElementById('statsInfo');
    const toolbar = document.querySelector('.toolbar') as HTMLElement;
    if (confirmBtn) {
      confirmBtn.style.display = 'none';
    }
    if (situationBtn) situationBtn.style.display = 'flex';
    if (statsInfo) statsInfo.style.display = 'flex';
    // 恢复工具栏布局
    if (toolbar) {
      toolbar.style.justifyContent = 'space-between';
    }
  }
  /** 隐藏工具栏按钮 */
  hideToolbarButtons(): void {
    // 已由 showConfirmButton 处理
  }
  /** 显示工具栏按钮 */
  showToolbarButtons(): void {
    // 已由 hideConfirmButton 处理
  }
  /** 清除选中状态 */
  clearSelection(): void {
    this.selectedPosition = null;
    this.hideConfirmButton();
    this.showToolbarButtons();
  }
  /** 重置状态 */
  reset(): void {
    this.selectedPosition = null;
    this.showToolbarButtons();
    this.hideConfirmButton();
  }
}
