/**
 * @fileoverview AI自对弈 UI 更新器
 */

import type { MMGameEndResult, MMGameState } from '../constants/MMConstants';
import { MM_SPEED_TEXT } from '../constants/MMConstants';

export interface MMUIUpdaterConfig {
  kataGoEngine: any;
  modelCards: Array<{ id: string; name: string; size: string }>;
}

/**
 * AI自对弈 UI 更新器
 */
export class MMUIUpdater {
  private kataGoEngine: any;
  private modelCards: Array<{ id: string; name: string; size: string }>;

  constructor(config: MMUIUpdaterConfig) {
    this.kataGoEngine = config.kataGoEngine;
    this.modelCards = config.modelCards;
  }

  /**
   * 更新按钮状态
   */
  updateButtonStates(state: MMGameState): void {
    const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement;
    const menuSituationBtn = document.getElementById('menuSituationBtn');
    const menuStopBtn = document.getElementById('menuStopBtn');
    
    if (!pauseBtn) return;
    
    switch (state) {
      case 'idle':
        pauseBtn.disabled = true;
        if (menuSituationBtn) menuSituationBtn.style.display = 'none';
        if (menuStopBtn) menuStopBtn.style.display = 'none';
        break;
        
      case 'loading':
        pauseBtn.disabled = true;
        if (menuSituationBtn) menuSituationBtn.style.display = 'none';
        if (menuStopBtn) menuStopBtn.style.display = 'none';
        break;
        
      case 'running':
        pauseBtn.disabled = false;
        pauseBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18">
            <rect x="6" y="4" width="4" height="16" fill="currentColor"/>
            <rect x="14" y="4" width="4" height="16" fill="currentColor"/>
          </svg>
        `;
        pauseBtn.title = '暂停';
        if (menuSituationBtn) menuSituationBtn.style.display = 'flex';
        if (menuStopBtn) menuStopBtn.style.display = 'flex';
        break;
        
      case 'paused':
        pauseBtn.disabled = false;
        pauseBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18">
            <polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>
          </svg>
        `;
        pauseBtn.title = '继续';
        if (menuSituationBtn) menuSituationBtn.style.display = 'flex';
        if (menuStopBtn) menuStopBtn.style.display = 'flex';
        break;
        
      case 'ended':
        pauseBtn.disabled = true;
        if (menuSituationBtn) menuSituationBtn.style.display = 'none';
        if (menuStopBtn) menuStopBtn.style.display = 'none';
        break;
    }
  }

  /**
   * 从状态更新状态栏
   */
  updateStatusBarFromState(state: MMGameState): void {
    switch (state) {
      case 'idle':
        this.updateStatusBar('等待开始...');
        break;
      case 'loading':
        this.updateStatusBar('正在加载模型...');
        break;
      case 'paused':
        this.updateStatusBar('对局已暂停');
        break;
      case 'ended':
        this.updateStatusBar('对局已结束');
        break;
      case 'running':
        // 由外部更新
        break;
    }
  }

  /**
   * 更新状态栏
   */
  updateStatusBar(text: string): void {
    const statusBar = document.getElementById('statusBar');
    if (statusBar) {
      statusBar.textContent = text;
    }
  }

  /**
   * 更新标题栏模型信息
   */
  updateModelInfo(modelId: string, visits: number, speed: string): void {
    const modelInfoEl = document.getElementById('modelInfo');
    if (modelInfoEl) {
      const model = this.modelCards.find(m => m.id === modelId);
      const modelName = model?.name || modelId;
      modelInfoEl.textContent = `${modelName} · ${visits} visits · ${MM_SPEED_TEXT[speed] || speed}`;
    }
  }

  /**
   * 更新手数显示
   */
  updateMoveCount(count: number): void {
    const moveCountEl = document.getElementById('moveCount');
    if (moveCountEl) {
      moveCountEl.textContent = String(count);
    }
  }

  /**
   * 更新提子数量显示
   */
  updateCaptures(blackCaptures: number, whiteCaptures: number): void {
    const blackCapturesEl = document.getElementById('blackCaptures');
    const whiteCapturesEl = document.getElementById('whiteCaptures');
    
    if (blackCapturesEl) {
      blackCapturesEl.textContent = String(blackCaptures);
    }
    
    if (whiteCapturesEl) {
      whiteCapturesEl.textContent = String(whiteCaptures);
    }
  }

  /**
   * 显示后端信息
   */
  showBackendInfo(): void {
    const backendInfoItem = document.getElementById('backendInfoItem');
    const backendDivider = document.getElementById('backendDivider');
    const backendStatus = document.getElementById('backendStatus');
    
    if (!backendInfoItem || !backendStatus || !this.kataGoEngine) return;
    
    try {
      const engineInfo = this.kataGoEngine.getEngineInfo?.();
      const backend = engineInfo?.backend || 'wasm';
      const simpleLabel = backend === 'native' ? 'NATIVE' :
                          backend === 'webgl' ? 'GPU' : 'CPU';
      backendStatus.textContent = simpleLabel;
      backendInfoItem.style.display = 'flex';
      if (backendDivider) backendDivider.style.display = 'block';
      
      if (backend === 'webgl') {
        backendStatus.style.color = '#4CAF50';
      } else {
        backendStatus.style.color = '#FF9800';
      }
    } catch (error) {
      // 忽略错误
    }
  }

  /**
   * 显示游戏结束对话框
   */
  showGameEndDialog(result: MMGameEndResult, currentOptions: any): void {
    const dialog = document.getElementById('gameEndDialog');
    const winnerEl = document.getElementById('resultWinner');
    const detailEl = document.getElementById('resultDetail');
    const moveCountEl = document.getElementById('endMoveCount');
    const modelInfoEl = document.getElementById('endModelInfo');
    
    if (!dialog || !winnerEl || !detailEl || !moveCountEl || !modelInfoEl) return;
    
    winnerEl.textContent = result.winner === 'black' ? '黑方胜' : '白方胜';
    detailEl.textContent = `${Math.abs(result.margin).toFixed(1)} 目`;
    moveCountEl.textContent = `${result.moveCount} 手`;
    
    if (currentOptions) {
      const model = this.modelCards.find(m => m.id === currentOptions.modelId);
      const modelName = model?.name || currentOptions.modelId;
      modelInfoEl.textContent = `${modelName} · ${currentOptions.visits} visits · ${MM_SPEED_TEXT[currentOptions.speed] || currentOptions.speed}`;
    }
    
    dialog.style.display = 'flex';
  }
}
