/**
 * ReplayPage UI 管理器
 * @description 负责所有 UI 元素的更新和事件绑定
 */
import type { WebBoard } from '../../../components/Board';
import type { ReplayPageState } from '../state/ReplayPageState';
import type { VariationController } from '../../../../../core/controllers';
export class ReplayPageUI {
  // DOM 元素引用
  private moveSlider: HTMLInputElement | null = null;
  private moveInfoEl: HTMLElement | null = null;
  private capturedInfoEl: HTMLElement | null = null;
  private variationPanel: HTMLElement | null = null;
  private variationList: HTMLElement | null = null;
  private trialPanel: HTMLElement | null = null;
  private blackNameEl: HTMLElement | null = null;
  private whiteNameEl: HTMLElement | null = null;
  private gameTitleEl: HTMLElement | null = null;
  private gameInfoEl: HTMLElement | null = null;
  private backToParentBtn: HTMLElement | null = null;
  private soundToggleBtn: HTMLElement | null = null;
  private numToggleBtn: HTMLElement | null = null;
  constructor(
    private state: ReplayPageState,
    private board: WebBoard,
    private variationController: VariationController,
    private translateResult: (result: string) => string
  ) {}
  /**
   * 绑定 DOM 事件
   */
  bindEvents(handlers: {
    onSliderChange: (value: number) => void;
    onPrevMove: () => void;
    onNextMove: () => void;
    onTogglePlay: () => void;
    onBackToParent: () => void;
    onToggleSound: () => void;
    onToggleMoveNumbers: () => void;
    onDownloadSGF: () => void;
    onTrialPrev: () => void;
    onExitTrial: () => void;
    onTrialNext: () => void;
  }): void {
    // 获取 DOM 元素
    this.moveSlider = document.getElementById('moveSlider') as HTMLInputElement;
    this.moveInfoEl = document.getElementById('moveInfo');
    this.capturedInfoEl = document.getElementById('capturedInfo');
    this.variationPanel = document.getElementById('variationPanel');
    this.variationList = document.getElementById('variationList');
    this.trialPanel = document.getElementById('trialPanel');
    this.blackNameEl = document.getElementById('blackName');
    this.whiteNameEl = document.getElementById('whiteName');
    this.gameTitleEl = document.getElementById('gameTitle');
    this.gameInfoEl = document.getElementById('gameInfo');
    this.backToParentBtn = document.getElementById('backToParentBtn');
    this.soundToggleBtn = document.getElementById('soundToggleBtn');
    this.numToggleBtn = document.getElementById('numToggleBtn');
    // 滑块事件
    this.moveSlider?.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value, 10);
      handlers.onSliderChange(value);
    });
    // 导航按钮（排除 playMenuItem，已经在 HTML 中处理）
    document.getElementById('prevBtn')?.addEventListener('click', handlers.onPrevMove);
    document.getElementById('nextBtn')?.addEventListener('click', handlers.onNextMove);
    // playBtn 已废弃，使用菜单项
    document.getElementById('backToParentBtn')?.addEventListener('click', handlers.onBackToParent);
    // 更多功能按钮（这些按钮在 control-row 中，不是菜单项）
    document.getElementById('soundToggleBtn')?.addEventListener('click', handlers.onToggleSound);
    document.getElementById('numToggleBtn')?.addEventListener('click', handlers.onToggleMoveNumbers);
    document.getElementById('downloadBtn')?.addEventListener('click', handlers.onDownloadSGF);
    // 菜单项（所有菜单项的事件都在 HTML 中绑定，通过事件触发）
    // downloadMenuItem 的事件在 HTML 中绑定，通过 downloadSGF 事件触发
    // 试下按钮
    document.getElementById('trialPrevBtn')?.addEventListener('click', handlers.onTrialPrev);
    document.getElementById('exitTrialBtn')?.addEventListener('click', handlers.onExitTrial);
    document.getElementById('trialNextBtn')?.addEventListener('click', handlers.onTrialNext);
  }
  /**
   * 更新游戏信息显示
   */
  updateGameInfo(): void {
    const replayData = this.state.get('replayData');
    if (!replayData) return;
    // 标题：对局名称
    if (this.gameTitleEl) {
      this.gameTitleEl.textContent = replayData.game_name || '棋谱查看器';
    }
    // 副标题：黑棋 vs 白棋 · 让子 · 结果
    if (this.gameInfoEl) {
      let info = `${replayData.black || '黑棋'} vs ${replayData.white || '白棋'}`;
      if (replayData.handicap && replayData.handicap > 0) {
        info += ` · 让${replayData.handicap}子`;
      }
      if (replayData.result) {
        info += ` · ${this.translateResult(replayData.result)}`;
      }
      this.gameInfoEl.textContent = info;
    }
    // 图例中的棋手名称
    if (this.blackNameEl) {
      const rank = replayData.black_rank ? ` (${replayData.black_rank})` : '';
      this.blackNameEl.textContent = (replayData.black || '黑棋') + rank;
    }
    if (this.whiteNameEl) {
      const rank = replayData.white_rank ? ` (${replayData.white_rank})` : '';
      this.whiteNameEl.textContent = (replayData.white || '白棋') + rank;
    }
    // 新增：header中的棋手名称（新的UI设计）
    const blackNameInHeader = document.getElementById('blackName');
    const whiteNameInHeader = document.getElementById('whiteName');
    if (blackNameInHeader) {
      blackNameInHeader.textContent = replayData.black || '黑棋';
    }
    if (whiteNameInHeader) {
      whiteNameInHeader.textContent = replayData.white || '白棋';
    }
    // 新增：胜负信息（header中）
    const resultInfoEl = document.getElementById('resultInfo');
    const resultTextEl = document.getElementById('resultText');
    if (resultInfoEl && resultTextEl) {
      if (replayData.result) {
        resultTextEl.textContent = this.translateResult(replayData.result);
        resultInfoEl.style.display = 'flex';
      } else {
        resultInfoEl.style.display = 'none';
      }
    }
    // 更新滑块最大值
    if (this.moveSlider) {
      this.moveSlider.max = String(replayData.max_moves || 0);
    }
  }
  /**
   * 更新滑块值
   */
  updateSlider(value: number): void {
    if (this.moveSlider) {
      this.moveSlider.value = String(value);
    }
  }
  /**
   * 更新播放按钮状态
   */
  updatePlayButton(isPlaying: boolean): void {
    // 更新菜单项
    const menuItem = document.getElementById('playMenuItem');
    if (menuItem) {
      menuItem.textContent = isPlaying ? '⏸ 自动播放' : '▶️ 自动播放';
    }
    // 兼容旧代码：更新按钮
    const btn = document.getElementById('playBtn');
    if (btn) {
      btn.textContent = isPlaying ? '⏸' : '播';
    }
    // 通知HTML更新菜单项图标
    window.dispatchEvent(new CustomEvent('playStateChanged', { detail: isPlaying }));
  }
  /**
   * 更新状态显示（手数）
   */
  updateStatusDisplay(): void {
    if (!this.moveInfoEl) return;
    const inVariation = this.state.get('inVariation');
    // 变化图模式下，隐藏第几手信息
    if (inVariation) {
      this.moveInfoEl.style.display = 'none';
      return;
    }
    // 正常模式下，显示第几手信息
    this.moveInfoEl.style.display = 'block';
    const moveNum = this.state.getCurrentMoveNumber();
    this.moveInfoEl.textContent = `第 ${moveNum} 手`;
  }
  /**
   * 更新提子显示
   */
  updateCapturedDisplay(black: number, white: number): void {
    if (this.capturedInfoEl) {
      if (black > 0 || white > 0) {
        this.capturedInfoEl.textContent = `提子：黑 ${black} | 白 ${white}`;
      } else {
        this.capturedInfoEl.textContent = '';
      }
    }
  }
  /**
   * 更新分支模式 UI
   */
  updateVariationModeUI(): void {
    if (!this.moveSlider) return;
    const inVariation = this.state.get('inVariation');
    const container = document.querySelector('.container');
    const playBtn = document.getElementById('playBtn');
    const moreBtn = document.getElementById('moreBtn');
    const extraButtons = document.getElementById('extraButtons');
    if (inVariation) {
      // 添加分支模式样式
      container?.classList.add('variation-mode');
      // 隐藏播放按钮和更多按钮
      if (playBtn) playBtn.style.display = 'none';
      if (moreBtn) moreBtn.style.display = 'none';
      if (extraButtons) extraButtons.classList.remove('visible');
      // 显示返回按钮
      if (this.backToParentBtn) this.backToParentBtn.style.display = 'flex';
      // 强制显示手数
      this.state.set('showMoveNumbers', true);
      this.board['config'].showMoveNumbers = true;
      // 隐藏第几手信息
      const moveInfo = document.getElementById('moveInfo');
      if (moveInfo) {
        moveInfo.style.display = 'none';
      }
    } else {
      // 移除分支模式样式
      container?.classList.remove('variation-mode');
      // 恢复所有按钮
      this.moveSlider.style.display = 'block';
      if (playBtn) playBtn.style.display = 'flex';
      if (moreBtn) moreBtn.style.display = 'flex';
      // 隐藏返回按钮
      if (this.backToParentBtn) this.backToParentBtn.style.display = 'none';
      // 恢复手数显示状态（退出变化图后，恢复到开关的状态）
      const showMoveNumbers = this.state.get('showMoveNumbers');
      this.board['config'].showMoveNumbers = showMoveNumbers;
      // 恢复第几手信息的显示
      const moveInfo = document.getElementById('moveInfo');
      if (moveInfo) {
        moveInfo.style.display = 'block';
      }
    }
  }
  /**
   * 更新分支面板
   */
  updateVariationPanel(onEnterVariation: (index: number) => void): void {
    if (!this.variationPanel || !this.variationList) return;
    const inVariation = this.state.get('inVariation');
    // 分支模式下，隐藏变化图面板
    if (inVariation) {
      this.variationPanel.classList.remove('visible');
      return;
    }
    const node = this.state.getCurrentNode();
    // 显示/隐藏返回按钮
    if (this.backToParentBtn) {
      const currentPath = this.state.get('currentPath');
      this.backToParentBtn.style.display = currentPath.length > 0 ? 'flex' : 'none';
    }
    if (!node?.children || node.children.length <= 1) {
      this.variationPanel.classList.remove('visible');
      return;
    }
    this.variationController.buildFromChildren(node.children as any);
    const variations = this.variationController.getVariations();
    if (variations.length === 0) {
      this.variationPanel.classList.remove('visible');
      return;
    }
    this.variationList.innerHTML = '';
    for (const v of variations) {
      const btn = document.createElement('button');
      btn.className = 'btn-variation';
      // 添加棋子图标
      if (v.color === 'B' || v.color === 'W') {
        const icon = document.createElement('span');
        icon.className = `stone-icon ${v.color === 'B' ? 'black' : 'white'}`;
        btn.appendChild(icon);
      }
      const label = document.createElement('span');
      label.textContent = v.label;
      btn.appendChild(label);
      btn.addEventListener('click', () => onEnterVariation(v.index));
      this.variationList!.appendChild(btn);
    }
    this.variationPanel.classList.add('visible');
  }
  /**
   * 更新试下模式 UI
   */
  updateTrialModeUI(): void {
    const container = document.querySelector('.container');
    const inTrial = container?.classList.contains('trial-mode');
    // 这个方法主要由外部调用 showTrialPanel 控制
  }
  /**
   * 显示/隐藏试下面板
   */
  showTrialPanel(visible: boolean): void {
    if (this.trialPanel) {
      this.trialPanel.classList.toggle('visible', visible);
    }
    const container = document.querySelector('.container');
    if (visible) {
      container?.classList.add('trial-mode');
    } else {
      container?.classList.remove('trial-mode');
    }
    // 进入试下模式时，隐藏控制栏和第几手信息
    const controlsBar = document.querySelector('.controls-row');
    if (controlsBar) {
      if (visible) {
        (controlsBar as HTMLElement).style.display = 'none';
      } else {
        (controlsBar as HTMLElement).style.display = 'flex';
      }
    }
    // 隐藏/显示第几手信息
    const moveInfo = document.getElementById('moveInfo');
    if (moveInfo) {
      if (visible) {
        moveInfo.style.display = 'none';
      } else {
        moveInfo.style.display = 'block';
      }
    }
  }
  /**
   * 更新音效按钮状态
   */
  updateSoundButton(soundEnabled: boolean): void {
    // 更新菜单项
    const menuItem = document.getElementById('soundMenuItem');
    if (menuItem) {
      menuItem.textContent = soundEnabled ? '🔊 音效开关' : '🔇 音效开关';
    }
    // 兼容旧代码：更新按钮
    if (this.soundToggleBtn) {
      this.soundToggleBtn.textContent = soundEnabled ? '🔊' : '🔇';
    }
  }
  /**
   * 更新手数显示按钮状态
   */
  updateMoveNumbersButton(showMoveNumbers: boolean): void {
    // 更新菜单项
    const menuItem = document.getElementById('numMenuItem');
    if (menuItem) {
      menuItem.textContent = showMoveNumbers ? '1️⃣ 显示手数' : '⭕ 显示手数';
    }
    // 兼容旧代码：更新按钮
    if (this.numToggleBtn) {
      this.numToggleBtn.style.opacity = showMoveNumbers ? '1' : '0.5';
    }
  }
}
