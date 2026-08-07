/**
 * 人机对弈 UI 更新器
 * @module presentation/pages/play/ui/HMUIUpdater
 */

import type { PlayerColor } from '../../../../../../domain';
import type { GameOptions, ModelCard, GameState } from '../HMPlayPage';

/**
 * 人机对弈 UI 更新器
 * 负责更新所有 UI 元素（状态栏、标题栏、按钮状态等）
 */
export class HMUIUpdater {
  private gameState: GameState = 'idle';
  private currentOptions: GameOptions | null = null;
  private modelCards: ModelCard[] = [];
  private kataGoEngine: any = null;

  /**
   * 设置游戏状态
   */
  setGameState(state: GameState): void {
    this.gameState = state;
    this.updateButtonStates(state);
    this.updateStatusBarFromState(state);
  }

  /**
   * 获取游戏状态
   */
  getGameState(): GameState {
    return this.gameState;
  }

  /**
   * 设置当前游戏选项
   */
  setCurrentOptions(options: GameOptions | null): void {
    this.currentOptions = options;
  }

  /**
   * 获取当前游戏选项
   */
  getCurrentOptions(): GameOptions | null {
    return this.currentOptions;
  }

  /**
   * 设置模型卡片列表
   */
  setModelCards(cards: ModelCard[]): void {
    this.modelCards = cards;
  }

  /**
   * 设置 KataGo 引擎实例
   */
  setKataGoEngine(engine: any): void {
    this.kataGoEngine = engine;
  }

  /**
   * 更新按钮状态
   */
  private updateButtonStates(state: GameState): void {
    const situationBtn = document.getElementById('situationBtn') as HTMLButtonElement;

    // 菜单中的按钮
    const menuUndoBtn = document.getElementById('menuUndoBtn') as HTMLButtonElement;
    const menuPassBtn = document.getElementById('menuPassBtn') as HTMLButtonElement;
    const menuResignBtn = document.getElementById('menuResignBtn') as HTMLButtonElement;

    if (!situationBtn) return;

    switch (state) {
      case 'idle':
      case 'loading':
        // 形势判断按钮禁用
        situationBtn.disabled = true;

        // 禁用菜单按钮
        if (menuUndoBtn) menuUndoBtn.disabled = true;
        if (menuPassBtn) menuPassBtn.disabled = true;
        if (menuResignBtn) menuResignBtn.disabled = true;
        break;

      case 'running':
        // 形势判断按钮启用
        situationBtn.disabled = false;

        // 启用菜单按钮(悔棋根据 noUndo 设置)
        if (menuUndoBtn) menuUndoBtn.disabled = this.currentOptions?.noUndo ?? false;
        if (menuPassBtn) menuPassBtn.disabled = false;
        if (menuResignBtn) menuResignBtn.disabled = false;
        break;

      case 'ended':
        // 形势判断按钮禁用
        situationBtn.disabled = true;

        // 禁用菜单按钮
        if (menuUndoBtn) menuUndoBtn.disabled = true;
        if (menuPassBtn) menuPassBtn.disabled = true;
        if (menuResignBtn) menuResignBtn.disabled = true;
        break;
    }
  }

  /**
   * 从状态更新状态栏
   */
  private updateStatusBarFromState(state: GameState): void {
    const statusBar = document.getElementById('gameStatus');
    if (!statusBar) return;

    switch (state) {
      case 'idle':
        statusBar.textContent = '等待开始...';
        break;
      case 'loading':
        statusBar.textContent = '正在加载模型...';
        break;
      case 'ended':
        statusBar.textContent = '对局已结束';
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
    const statusBar = document.getElementById('gameStatus');
    if (statusBar) {
      statusBar.textContent = text;
    }
  }

  /**
   * 更新标题栏
   */
  updateTitleBar(playerColor: PlayerColor): void {
    const pageTitle = document.getElementById('pageTitle');
    if (!pageTitle) return;

    if (playerColor === 'black') {
      // 玩家执黑:黑方=玩家,白方=AI
      pageTitle.innerHTML = `
        <span class="stone-dot black"></span>玩家
        <span style="opacity:0.6">vs</span>
        <span class="stone-dot white"></span>AI
      `;
    } else {
      // 玩家执白:黑方=AI,白方=玩家
      pageTitle.innerHTML = `
        <span class="stone-dot black"></span>AI
        <span style="opacity:0.6">vs</span>
        <span class="stone-dot white"></span>玩家
      `;
    }
  }

  /**
   * 更新标题栏模型信息
   */
  updateModelInfo(options: GameOptions): void {
    const modelInfoEl = document.getElementById('modelInfo');
    if (modelInfoEl) {
      // 根据 modelId 找到模型名称（显示版本信息而不是文件名）
      const model = this.modelCards.find(m => m.id === options.modelId);
      const modelName = model?.name || options.modelId;

      const colorText = options.playerColor === 'black' ? '执黑' : '执白';
      modelInfoEl.textContent = `${modelName} · ${options.visits} visits · ${colorText}`;
    }
  }

  /**
   * 显示后端引擎信息
   */
  showBackendInfo(): void {
    const backendInfoItem = document.getElementById('backendInfoItem');
    const backendDivider = document.getElementById('backendDivider');
    const backendStatus = document.getElementById('backendStatus');

    if (!backendInfoItem || !backendStatus || !this.kataGoEngine) return;

    // 获取后端类型
    try {
      const engineInfo = this.kataGoEngine.getEngineInfo?.();
      const backend = engineInfo?.backend || 'wasm';
      const simpleLabel = backend === 'native' ? 'NATIVE' :
                          backend === 'webgl' ? 'GPU' : 'CPU';
      backendStatus.textContent = simpleLabel;
      backendInfoItem.style.display = 'flex';
      if (backendDivider) backendDivider.style.display = 'block';

      // 根据后端类型设置颜色
      if (backend === 'webgl') {
        backendStatus.style.color = '#4CAF50';
      } else {
        backendStatus.style.color = '#FF9800';
      }
    } catch (error) {
      // 静默处理：无法获取后端信息
    }
  }

  /**
   * 渲染模型卡片
   */
  renderModelCards(): void {
    const container = document.getElementById('modelCards');
    if (!container) return;

    const html = this.modelCards.map((model, index) => {
      const selected = (index === 0 && this.modelCards.length > 0) ? 'checked' : '';
      const cardStyle = selected ? 'border: 2px solid #667eea; background: #f0f4ff;' : 'border: 1px solid #ddd;';

      return `
        <div class="model-card" data-model-id="${model.id}" style="margin-bottom: 10px; padding: 12px; border-radius: 8px; cursor: pointer; ${cardStyle}">
          <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer;">
            <input type="radio" name="aiModel" value="${model.id}" ${selected} style="width: auto; margin-top: 3px;">
            <div style="flex: 1;">
              <div style="font-weight: 500; margin-bottom: 4px;">${model.name}</div>
              <div style="font-size: 12px; color: #666;">${model.size}</div>
            </div>
          </label>
        </div>
      `;
    }).join('');

    container.innerHTML = html;

    // 绑定模型卡片点击事件
    const cards = container.querySelectorAll('.model-card');
    cards.forEach(card => {
      card.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT') return;

        const radio = card.querySelector('input[type="radio"]') as HTMLInputElement;
        if (radio) {
          radio.checked = true;
          cards.forEach(c => {
            (c as HTMLElement).style.border = '1px solid #ddd';
            (c as HTMLElement).style.background = 'white';
          });
          (card as HTMLElement).style.border = '2px solid #667eea';
          (card as HTMLElement).style.background = '#f0f4ff';
        }
      });
    });
  }
}
