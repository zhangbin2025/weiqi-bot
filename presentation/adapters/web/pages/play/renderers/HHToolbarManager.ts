/**
 * @fileoverview 工具栏管理器 - 管理工具栏按钮显示
 * @description 封装工具栏按钮的显示/隐藏逻辑
 */
/** 工具栏按钮 ID */
const TOOLBAR_BUTTONS = ['undoBtn', 'passBtn', 'countBtn', 'resignBtn'];
/**
 * 工具栏管理器
 * @description 负责管理工具栏按钮的显示状态
 */
export class HHToolbarManager {
  /**
   * 显示确认按钮
   */
  showConfirmButton(): void {
    const btn = document.getElementById('confirmBtn');
    if (btn) btn.style.display = 'flex';
  }
  /**
   * 隐藏确认按钮
   */
  hideConfirmButton(): void {
    const btn = document.getElementById('confirmBtn');
    if (btn) btn.style.display = 'none';
  }
  /**
   * 显示工具栏按钮
   */
  showToolbarButtons(): void {
    TOOLBAR_BUTTONS.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.style.display = 'flex';
    });
  }
  /**
   * 隐藏工具栏按钮
   */
  hideToolbarButtons(): void {
    TOOLBAR_BUTTONS.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.style.display = 'none';
    });
  }
  /**
   * 更新按钮状态
   * @param enabled 是否启用
   * @param isMyTurn 是否轮到我
   * @param hasHistory 是否有历史记录
   */
  updateButtonState(enabled: boolean, isMyTurn: boolean, hasHistory: boolean): void {
    TOOLBAR_BUTTONS.forEach(id => {
      const btn = document.getElementById(id) as HTMLButtonElement;
      if (btn) {
        if (id === 'undoBtn') {
          btn.disabled = !enabled || !hasHistory;
        } else if (id === 'resignBtn') {
          btn.disabled = !enabled;
        } else {
          btn.disabled = !enabled || !isMyTurn;
        }
      }
    });
  }
}
