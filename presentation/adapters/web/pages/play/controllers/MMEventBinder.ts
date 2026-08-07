/**
 * @fileoverview AI自对弈事件绑定器
 */

import { getWebRoot } from '../../../../../../infrastructure/utils/web/pathUtils';
import type { MMPlayApp } from '../../../../../../application/play/MMPlayApp';

export interface MMEventBinderConfig {
  mmPlayApp: MMPlayApp;
  getGameState: () => string;
  setGameState: (state: string) => void;
  showSituationDialog: () => void;
  handleEarlyStop: () => void;
}

/**
 * AI自对弈事件绑定器
 */
export class MMEventBinder {
  private mmPlayApp: MMPlayApp;
  private getGameState: () => string;
  private setGameState: (state: string) => void;
  private showSituationDialog: () => void;
  private handleEarlyStop: () => void;

  constructor(config: MMEventBinderConfig) {
    this.mmPlayApp = config.mmPlayApp;
    this.getGameState = config.getGameState;
    this.setGameState = config.setGameState;
    this.showSituationDialog = config.showSituationDialog;
    this.handleEarlyStop = config.handleEarlyStop;
  }

  /**
   * 绑定所有 UI 事件
   */
  bindAllEvents(): void {
    this.bindMenuEvents();
    this.bindToolbarEvents();
    this.bindDialogEvents();
  }

  /**
   * 绑定菜单事件
   */
  private bindMenuEvents(): void {
    const menuBtn = document.getElementById('menuBtn');
    const dropdownMenu = document.getElementById('dropdownMenu');
    const menuSituationBtn = document.getElementById('menuSituationBtn');
    const menuStopBtn = document.getElementById('menuStopBtn');
    
    if (!menuBtn || !dropdownMenu) return;
    
    // 点击菜单按钮
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownMenu.classList.toggle('visible');
    });
    
    // 点击其他地方关闭菜单
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.dropdown')) {
        dropdownMenu.classList.remove('visible');
      }
    });
    
    // 形势判断菜单项
    menuSituationBtn?.addEventListener('click', () => {
      dropdownMenu.classList.remove('visible');
      const gameState = this.getGameState();
      if (gameState === 'running' || gameState === 'paused') {
        this.showSituationDialog();
      }
    });
    
    // 结束对局菜单项
    menuStopBtn?.addEventListener('click', () => {
      dropdownMenu.classList.remove('visible');
      const gameState = this.getGameState();
      if (gameState === 'running' || gameState === 'paused') {
        this.handleEarlyStop();
      }
    });
  }

  /**
   * 绑定工具栏按钮事件
   */
  private bindToolbarEvents(): void {
    const pauseBtn = document.getElementById('pauseBtn');
    
    // 暂停/继续按钮
    pauseBtn?.addEventListener('click', () => {
      const gameState = this.getGameState();
      if (gameState === 'running') {
        this.mmPlayApp.pause();
        this.setGameState('paused');
      } else if (gameState === 'paused') {
        this.mmPlayApp.resume();
        this.setGameState('running');
      }
    });
  }

  /**
   * 绑定弹框按钮事件
   */
  private bindDialogEvents(): void {
    // 关闭形势判断弹框
    const closeSituationBtn = document.getElementById('closeSituationBtn');
    closeSituationBtn?.addEventListener('click', () => {
      const dialog = document.getElementById('situationDialog');
      if (dialog) dialog.style.display = 'none';
    });
    
    // 确认对话框按钮
    const confirmCancelBtn = document.getElementById('confirmCancelBtn');
    const confirmOkBtn = document.getElementById('confirmOkBtn');
    
    confirmCancelBtn?.addEventListener('click', () => {
      const dialog = document.getElementById('confirmDialog');
      if (dialog) dialog.style.display = 'none';
    });
    
    confirmOkBtn?.addEventListener('click', () => {
      const dialog = document.getElementById('confirmDialog');
      if (dialog) dialog.style.display = 'none';
      // 触发确认回调
      window.dispatchEvent(new CustomEvent('confirmOk'));
    });
    
    // 结束弹窗按钮
    const viewHistoryBtn = document.getElementById('viewHistoryBtn');
    const newGameBtn = document.getElementById('newGameBtn');
    
    viewHistoryBtn?.addEventListener('click', () => {
      window.location.href = getWebRoot() + 'replay/list.html?category=play&key=all';
    });
    
    newGameBtn?.addEventListener('click', () => {
      const dialog = document.getElementById('gameEndDialog');
      if (dialog) dialog.style.display = 'none';
      
      // 重置状态并重新打开设置对话框
      this.setGameState('idle');
      // 触发显示设置对话框事件
      window.dispatchEvent(new CustomEvent('showSettingsDialog'));
    });
  }
}
