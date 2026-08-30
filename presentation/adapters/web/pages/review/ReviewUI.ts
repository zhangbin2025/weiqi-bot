/**
 * 复盘页面 UI 操作 — DOM 绑定、菜单、配置对话框、事件处理
 * @module presentation/adapters/web/pages/review/ReviewUI
 */
import { Dialog, Select } from '@ui';
import type { ReviewApp } from '../../../../../application/review';
import { ModelSelector } from '../../components/ModelSelector';
import { DefaultModelService } from '../../../../../services/model';
import type { ModelConfig } from '../../../../../services/model/types';

/** 将任意值 HTML escape 后嵌入 attribute */
export function attrEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** UI 回调 */
export interface UICallbacks {
  onPrevMove: () => void;
  onNextMove: () => void;
  onGoToMove: (move: number) => void;
  onAnalyze: () => void;
  onUndo: () => void;
  onExit: () => void;
  onToggleSound: () => void;
  onFileSelect: (file: File) => Promise<void>;
  onShowHistory: () => void;
  onShowConfig: () => void;
  onHandleKeyDown: (event: KeyboardEvent) => void;
  onToggleLiveRecommendations?: () => void;
  onRefreshIntervalChange?: (seconds: number) => void;
  onToggleRegionSelection?: () => void;
}

/**
 * 复盘 UI 管理器
 *
 * 管理 DOM 元素引用、事件绑定、菜单、配置对话框等 UI 操作。
 */
export class ReviewUI {
  private callbacks: UICallbacks;
  // 标题栏点击计数器（5次点击切换AI选点显示）
  private titleClickCount = 0;
  private titleClickTimer?: number;

  // DOM 元素
  private moveSlider: HTMLInputElement | null = null;
  private moveNumberEl: HTMLElement | null = null;
  private resultInfoEl: HTMLElement | null = null;
  private progressBarEl: HTMLElement | null = null;
  private progressFillEl: HTMLElement | null = null;
  private loadingTextEl: HTMLElement | null = null;
  private loadingProgressEl: HTMLElement | null = null;
  private menuBtnEl: HTMLElement | null = null;
  private dropdownMenuEl: HTMLElement | null = null;
  private importBtnEl: HTMLElement | null = null;
  private historyBtnEl: HTMLElement | null = null;
  private configBtnEl: HTMLElement | null = null;
  private fileInputEl: HTMLInputElement | null = null;
  private chartStatsEl: HTMLElement | null = null;
  private specialControlsBarEl: HTMLElement | null = null;
  private mainControlsBarEl: HTMLElement | null = null;
  private depthCountEl: HTMLElement | null = null;
  private regionSelectBtnEl: HTMLElement | null = null;
  private regionStatusEl: HTMLElement | null = null;

  // 配置
  private configVisits = 200;  // 默认分析局面用
  private modelManager: any = null;  // ModelManagementService 引用
  private readonly CONFIG_KEY = 'review-config';

  // 音效
  private soundEnabled = true;
  // 分析局面模式标志（禁用胜率图和导航控件）
  private analyzePositionMode = false;

  constructor(callbacks: UICallbacks) {
    this.callbacks = callbacks;
  }

  /** 获取 DOM 元素引用 */
  getElements() {
    return {
      moveSlider: this.moveSlider,
      moveNumberEl: this.moveNumberEl,
      resultInfoEl: this.resultInfoEl,
      progressBarEl: this.progressBarEl,
      progressFillEl: this.progressFillEl,
      loadingTextEl: this.loadingTextEl,
      loadingProgressEl: this.loadingProgressEl,
      specialControlsBarEl: this.specialControlsBarEl,
      mainControlsBarEl: this.mainControlsBarEl,
      depthCountEl: this.depthCountEl,
    };
  }

  /** 获取配置 */
  getConfig() {
    return { configVisits: this.configVisits, soundEnabled: this.soundEnabled };
  }

  /** 初始化 DOM 元素引用 */
  setupComponents(): void {
    this.moveSlider = document.getElementById('moveSlider') as HTMLInputElement;
    this.moveNumberEl = document.getElementById('moveNumber');
    this.resultInfoEl = document.getElementById('resultInfo');
    this.progressBarEl = document.getElementById('progressBar');
    this.progressFillEl = document.getElementById('progressFill');
    this.loadingTextEl = document.getElementById('loadingText');
    this.loadingProgressEl = document.getElementById('loadingProgress');
    this.menuBtnEl = document.getElementById('menuBtn');
    this.dropdownMenuEl = document.getElementById('dropdownMenu');
    this.importBtnEl = document.getElementById('importBtn');
    this.historyBtnEl = document.getElementById('historyBtn');
    this.configBtnEl = document.getElementById('configBtn');
    this.fileInputEl = document.getElementById('fileInput') as HTMLInputElement;
    this.chartStatsEl = document.getElementById('chartStats');
    this.specialControlsBarEl = document.getElementById('specialControlsBar');
    this.mainControlsBarEl = document.getElementById('mainControlsBar');
    this.depthCountEl = document.getElementById('depthCount');    this.regionSelectBtnEl = document.getElementById('regionSelectBtn');    this.regionStatusEl = document.getElementById('regionStatus');
    this.setupMenu();
  }

  /** 绑定事件 */
  bindEvents(): void {
    this.setupTitleBarClick();
    document.getElementById('prevBtn')?.addEventListener('click', () => this.callbacks.onPrevMove());
    document.getElementById('nextBtn')?.addEventListener('click', () => this.callbacks.onNextMove());
    document.getElementById('aiBtn')?.addEventListener('click', () => this.callbacks.onAnalyze());
    this.moveSlider?.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value, 10);
      this.callbacks.onGoToMove(value);
    });
    document.getElementById('undoBtn')?.addEventListener('click', () => this.callbacks.onUndo());
    document.getElementById('aiRecommendBtn')?.addEventListener('click', () => this.callbacks.onAnalyze());
    document.getElementById('exitBtn')?.addEventListener('click', () => this.callbacks.onExit());
    document.getElementById('exitBtn2')?.addEventListener('click', () => this.callbacks.onExit());
    document.addEventListener('keydown', (e) => this.callbacks.onHandleKeyDown(e));
    this.fileInputEl?.addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (file) {
        await this.callbacks.onFileSelect(file);
      }
      input.value = '';
    });
    window.addEventListener('toggleSound', () => this.callbacks.onToggleSound());
  }

  /** 设置菜单 */
  private setupMenu(): void {
    this.menuBtnEl?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu();
    });
    const soundMenuItem = document.getElementById('soundMenuItem');
    soundMenuItem?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeMenu();
      this.callbacks.onToggleSound();
    });
    this.importBtnEl?.addEventListener('click', () => {
      this.closeMenu();
      this.triggerFileInput();
    });
    this.historyBtnEl?.addEventListener('click', () => {
      this.closeMenu();
      this.callbacks.onShowHistory();
    });
    this.configBtnEl?.addEventListener('click', () => {
      this.closeMenu();
      this.callbacks.onShowConfig();
    });
    document.addEventListener('click', () => this.closeMenu());
    this.regionSelectBtnEl?.addEventListener('click', () => {      this.closeMenu();      this.callbacks.onToggleRegionSelection?.();    });
  }

  private toggleMenu(): void {
    this.dropdownMenuEl?.classList.toggle('visible');
  }

  private closeMenu(): void {
    this.dropdownMenuEl?.classList.remove('visible');
  }

  private triggerFileInput(): void {
    this.fileInputEl?.click();
  }

  // ========== 状态更新 ==========

  updateStatus(msg: string): void {
    if (this.resultInfoEl) {
      this.resultInfoEl.innerHTML = `<span>${msg}</span>`;
    }
  }

  updateGameInfo(blackName?: string, whiteName?: string, result?: string): void {
    if (blackName) {
      const el = document.getElementById('blackName');
      if (el) el.textContent = blackName;
    }
    if (whiteName) {
      const el = document.getElementById('whiteName');
      if (el) el.textContent = whiteName;
    }
    if (this.resultInfoEl) {
      if (result) {
        this.resultInfoEl.innerHTML = `<span>${result}</span>`;
      }
      // 不再在副标题重复显示 "黑名 vs 白名"，主标题已有
    }
  }

  /**
   * 更新直播模式AI选点状态显示
   */
  updateLiveRecommendationsStatus(enabled: boolean): void {
    const el = document.querySelector('.page-title');
    if (el) {
      const indicator = el.querySelector('.ai-indicator') as HTMLElement | null;
      if (indicator) {
        indicator.textContent = enabled ? '🤖' : '';
        indicator.style.display = enabled ? '' : 'none';
      }
    }
    this.updateStatus(enabled ? '直播中' : '直播中（AI选点已关闭）');
  }

  /** 直播模式开启时显示AI指示器 */
  showLiveModeIndicator(): void {
    const el = document.querySelector('.page-title');
    if (el) {
      const indicator = el.querySelector('.ai-indicator') as HTMLElement | null;
      if (indicator) {
        indicator.style.display = '';
        indicator.textContent = '🤖';
        indicator.style.cursor = 'pointer';
        indicator.title = '点击设置刷新间隔';
        // 绑定点击事件（只绑一次）
        if (!indicator.dataset['bound']) {
          indicator.dataset['bound'] = '1';
          indicator.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showRefreshIntervalPicker();
          });
        }
      }
    }
  }

  /** 显示刷新间隔选择器 */
  private showRefreshIntervalPicker(): void {
    const existing = document.getElementById('refresh-interval-picker');
    if (existing) { existing.remove(); return; }

    const close = () => { overlay.remove(); picker.remove(); };

    // 遮罩层
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2000;background:rgba(0,0,0,0.3);';
    overlay.addEventListener('click', close);

    // 面板（与配置对话框风格一致）
    const picker = document.createElement('div');
    picker.id = 'refresh-interval-picker';
    picker.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;border-radius:12px;padding:20px 24px;z-index:2001;box-shadow:0 8px 32px rgba(0,0,0,0.15);min-width:200px;';
    picker.innerHTML = '<div style="color:#333;font-size:15px;font-weight:600;margin-bottom:12px;text-align:center;">刷新间隔</div>';

    const options = [5, 10, 15, 20, 30];
    for (const sec of options) {
      const btn = document.createElement('button');
      btn.textContent = sec + ' 秒';
      btn.style.cssText = 'display:block;width:100%;padding:10px 0;margin:4px 0;background:#f5f5f5;color:#333;border:none;border-radius:8px;font-size:14px;cursor:pointer;transition:background 0.15s;';
      btn.addEventListener('mouseenter', () => { btn.style.background = '#667eea'; btn.style.color = 'white'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = '#f5f5f5'; btn.style.color = '#333'; });
      btn.addEventListener('click', () => {
        this.callbacks.onRefreshIntervalChange?.(sec);
        close();
      });
      picker.appendChild(btn);
    }

    document.body.appendChild(overlay);
    document.body.appendChild(picker);
  }

  /** 直播模式关闭时隐藏AI指示器 */
  hideLiveModeIndicator(): void {
    const el = document.querySelector('.page-title');
    if (el) {
      const indicator = el.querySelector('.ai-indicator') as HTMLElement | null;
      if (indicator) {
        indicator.style.display = 'none';
      }
    }
  }

  /**
   * 绑定标题栏点击事件（5次点击切换AI选点）
   */
  private setupTitleBarClick(): void {
    const titleEl = document.querySelector('.page-title');
    if (!titleEl) return;
    
    titleEl.addEventListener('click', () => {
      // 清除之前的定时器
      if (this.titleClickTimer) {
        clearTimeout(this.titleClickTimer);
      }
      
      this.titleClickCount++;
      console.log('[ReviewUI] 标题栏点击次数:', this.titleClickCount);
      
      // 5次点击触发切换
      if (this.titleClickCount >= 5) {
        this.titleClickCount = 0;
        this.callbacks.onToggleLiveRecommendations?.();
      }
      
      // 2秒内未达到5次，重置计数
      this.titleClickTimer = setTimeout(() => {
        this.titleClickCount = 0;
      }, 2000) as unknown as number;
    });
  }

  showProgress(show: boolean): void {
    if (this.progressBarEl) this.progressBarEl.style.display = show ? 'block' : 'none';
    // 隐藏进度条时，同时清空百分比文本
    if (!show && this.loadingProgressEl) this.loadingProgressEl.textContent = '';
  }

  updateProgress(percent: number): void {
    if (this.progressFillEl) this.progressFillEl.style.width = `${percent}%`;
    if (this.loadingProgressEl) this.loadingProgressEl.textContent = `${percent}%`;
  }

  updateLoadingText(text: string): void {
    if (this.loadingTextEl) this.loadingTextEl.textContent = text;
  }

  showLoadingAnimation(show: boolean): void {
    const loadingEl = document.getElementById('loadingOverlay');
    if (loadingEl) loadingEl.style.display = show ? 'flex' : 'none';
  }

  updateDisplay(currentMove: number, totalMoves: number, winRate?: number, scoreLead?: number): void {
    if (this.moveNumberEl) {
      this.moveNumberEl.textContent = `${currentMove}/${totalMoves}`;
    }
  }

  setSliderMax(max: number): void {
    if (this.moveSlider) this.moveSlider.max = max.toString();
  }

  setSliderValue(value: number): void {
    if (this.moveSlider) this.moveSlider.value = value.toString();
  }

  updateUIForMode(mode: string): void {
    if (this.mainControlsBarEl) {
      this.mainControlsBarEl.style.display = (mode === 'normal') ? 'flex' : 'none';
    }
    if (this.specialControlsBarEl) {
      this.specialControlsBarEl.classList.toggle('visible', mode !== 'normal');
    }
    const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement | null;
    const aiRecommendBtn = document.getElementById('aiRecommendBtn') as HTMLButtonElement | null;
    if (undoBtn) undoBtn.style.display = (mode === 'variation' || mode === 'trial') ? 'flex' : 'none';
    if (aiRecommendBtn) aiRecommendBtn.style.display = (mode === 'variation' || mode === 'trial') ? 'flex' : 'none';
    this.showChartAndBadmoveInfo(mode === 'normal');
  }

  showChartAndBadmoveInfo(show: boolean): void {
    // 分析局面模式：永远不显示胜率图
    if (this.analyzePositionMode) {
      const chartContainer = document.getElementById('chart-container');
      if (chartContainer) chartContainer.style.display = 'none';
      return;
    }
    const chartContainer = document.getElementById('chart-container');
    if (chartContainer) chartContainer.style.display = show ? 'block' : 'none';
  }

  updateDepthIndicator(depth: number, maxDepth: number, onSliderChange?: (value: number) => void): void {
    if (!this.depthCountEl) return;
    
    // 更新深度计数
    this.depthCountEl.textContent = String(depth);
    
    // 更新滑条
    const slider = document.getElementById('depthSlider') as HTMLInputElement | null;
    if (slider) {
      // 滑条的 max 是 MAX_DEPTH（200），value 是当前深度
      // 这样滑块位置显示当前深度占总深度的比例
      slider.max = String(maxDepth);
      slider.value = String(depth);
      
      // 添加滑条变化事件（只允许回撤，不允许前进）
      if (onSliderChange) {
        slider.oninput = () => {
          const newValue = parseInt(slider.value, 10);
          const currentDepth = this.depthCountEl ? parseInt(this.depthCountEl.textContent || '0', 10) : 0;
          // 只允许回撤（newValue < currentDepth），不允许前进
          if (newValue < currentDepth) {
            onSliderChange(newValue);
          } else {
            // 如果尝试前进，恢复到当前深度
            slider.value = String(currentDepth);
          }
        };
      }
    }
  }

  updateButtonsState(isMaxDepth: boolean): void {
    const aiBtn = document.getElementById('aiRecommendBtn') as HTMLButtonElement | null;
    if (aiBtn) aiBtn.disabled = isMaxDepth;
  }

  updateUndoButtonState(disabled: boolean): void {
    this.setButtonEnabled('undoBtn', !disabled);
  }

  updateBackendInfo(backendInfo: { backend: string; label: string }): void {
    const backendInfoItem = document.getElementById('backendInfoItem');
    const backendDivider = document.getElementById('backendDivider');
    const backendStatus = document.getElementById('backendStatus');
    if (backendInfoItem && backendDivider && backendStatus) {
      backendStatus.textContent = backendInfo.backend.toUpperCase();
      backendInfoItem.style.display = 'flex';
      backendDivider.style.display = 'block';
      if (backendInfo.backend === 'webgpu') backendStatus.style.color = '#2196F3';
      else if (backendInfo.backend === 'webgl') backendStatus.style.color = '#4CAF50';
      else if (backendInfo.backend === 'wasm') backendStatus.style.color = '#FFC107';
      else { backendStatus.style.color = '#FF9800'; console.warn('当前使用 CPU 模式，建议使用支持 WebGL 的浏览器。'); }
    }
  }

  updateSoundButton(soundEnabled: boolean): void {
    const menuItem = document.getElementById('soundMenuItem');
    if (menuItem) menuItem.textContent = soundEnabled ? '🔊 音效开关' : '🔇 音效开关';
  }

  toggleSound(): boolean {
    this.soundEnabled = !this.soundEnabled;
    this.updateSoundButton(this.soundEnabled);
    if (this.soundEnabled) {
      // 初始化音频
    }
    return this.soundEnabled;
  }

  isSoundEnabled(): boolean { return this.soundEnabled; }

  updateRegionSelectionStatus(hasSelection: boolean): void {
    if (this.regionStatusEl) {
      this.regionStatusEl.textContent = hasSelection ? ' ✓' : ' ✗';
    }
  }

  showHistory(): void {
    window.location.href = '../replay/list.html?category=review&key=all';
  }


  /**
   * 设置直播模式
   * @param isLive 是否为直播模式
   */
  setLiveMode(isLive: boolean): void {
    // 隐藏右上角菜单按钮（三个点）
    if (this.menuBtnEl) {
      this.menuBtnEl.style.display = isLive ? 'none' : 'flex';
    }
    // 关闭下拉菜单（如果打开的话）
    if (isLive) {
      this.closeMenu();
    }
    
    // 动态修改 AI 推荐按钮文字
    const aiRecommendBtn = document.getElementById('aiRecommendBtn');
    if (aiRecommendBtn) {
      aiRecommendBtn.textContent = isLive ? '研究' : 'AI';
      aiRecommendBtn.title = isLive ? '研究' : 'AI推荐';
    }
    
    const aiBtn = document.getElementById('aiBtn');
    if (aiBtn) {
      aiBtn.textContent = isLive ? '研究' : 'AI';
      aiBtn.title = isLive ? '研究' : 'AI推荐';
    }
    
    // 直播模式：禁用滑条和导航按钮
    if (isLive) {
      // 禁用滑条
      if (this.moveSlider) {
        this.moveSlider.disabled = true;
        this.moveSlider.style.opacity = '0.5';
        this.moveSlider.style.cursor = 'not-allowed';
      }
      
      // 禁用上一步/下一步按钮
      const prevBtn = document.getElementById('prevBtn');
      if (prevBtn) {
        prevBtn.setAttribute('disabled', 'true');
        (prevBtn as HTMLButtonElement).disabled = true;
        prevBtn.style.opacity = '0.5';
        prevBtn.style.cursor = 'not-allowed';
      }
      
      const nextBtn = document.getElementById('nextBtn');
      if (nextBtn) {
        nextBtn.setAttribute('disabled', 'true');
        (nextBtn as HTMLButtonElement).disabled = true;
        nextBtn.style.opacity = '0.5';
        nextBtn.style.cursor = 'not-allowed';
      }
      
      // 禁用撤销按钮（直播模式不允许试下）
      const undoBtn = document.getElementById('undoBtn');
      if (undoBtn) {
        undoBtn.setAttribute('disabled', 'true');
        (undoBtn as HTMLButtonElement).disabled = true;
        undoBtn.style.opacity = '0.5';
        undoBtn.style.cursor = 'not-allowed';
      }
    } else {
      // 非直播模式：恢复控件
      if (this.moveSlider) {
        this.moveSlider.disabled = false;
        this.moveSlider.style.opacity = '1';
        this.moveSlider.style.cursor = 'pointer';
      }
      
      const prevBtn = document.getElementById('prevBtn');
      if (prevBtn) {
        prevBtn.removeAttribute('disabled');
        (prevBtn as HTMLButtonElement).disabled = false;
        prevBtn.style.opacity = '1';
        prevBtn.style.cursor = 'pointer';
      }
      
      const nextBtn = document.getElementById('nextBtn');
      if (nextBtn) {
        nextBtn.removeAttribute('disabled');
        (nextBtn as HTMLButtonElement).disabled = false;
        nextBtn.style.opacity = '1';
        nextBtn.style.cursor = 'pointer';
      }
      
      const undoBtn = document.getElementById('undoBtn');
      if (undoBtn) {
        undoBtn.removeAttribute('disabled');
        (undoBtn as HTMLButtonElement).disabled = false;
        undoBtn.style.opacity = '1';
        undoBtn.style.cursor = 'pointer';
      }
    }
  }
  /** 隐藏胜率图（分析局面模式） */
  hideChart(): void {
    this.analyzePositionMode = true;
    const chartContainer = document.getElementById('chart-container');
    if (chartContainer) {
      chartContainer.style.display = 'none';
    }
    // 也隐藏 chart-section
    const chartSection = document.querySelector('.chart-section') as HTMLElement;
    if (chartSection) {
      chartSection.style.display = 'none';
    }
  }

  /** 禁用导航控件（滑条、上一步、下一步） */
  disableNavigation(): void {
    this.analyzePositionMode = true;
    // 禁用滑条
    if (this.moveSlider) {
      this.moveSlider.disabled = true;
      this.moveSlider.style.opacity = '0.3';
    }
    // 禁用上一步/下一步按钮
    const prevBtn = document.getElementById('prevBtn') as HTMLButtonElement;
    const nextBtn = document.getElementById('nextBtn') as HTMLButtonElement;
    if (prevBtn) {
      prevBtn.disabled = true;
      prevBtn.style.opacity = '0.3';
    }
    if (nextBtn) {
      nextBtn.disabled = true;
      nextBtn.style.opacity = '0.3';
    }
  }


  /**
   * 显示"返回直播"按钮（从直播进入复盘时）
   */
  showBackToLive(_liveUrl: string): void {
    const headerRight = document.querySelector('.page-header .header-right') as HTMLElement | null;
    if (!headerRight) return;
    // 避免重复添加
    if (document.getElementById('backToLiveBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'backToLiveBtn';
    btn.title = '返回直播';
    btn.style.cssText = 'display:flex;align-items:center;gap:4px;margin-right:6px;padding:4px 8px;font-size:13px;border:none;border-radius:4px;background:transparent;color:rgba(255,255,255,0.8);cursor:pointer;';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg><span>直播</span>';
    btn.addEventListener('click', () => {
      history.back();
    });
    headerRight.insertBefore(btn, headerRight.firstChild);
  }
  // ========== 配置 ==========

  async loadConfig(): Promise<void> {
    try {
      const saved = localStorage.getItem(this.CONFIG_KEY);
      if (saved) {
        const config = JSON.parse(saved);
        this.configVisits = config.visits ?? 200;
      }
    } catch (error) {
      console.error('加载配置失败', error as Error | undefined);
    }
  }

  /**
   * 设置 ModelManagementService 引用
   * @description 用于读取和保存全局模型配置
   */
  setModelManager(modelManager: any): void {
    this.modelManager = modelManager;
  }

  async saveConfig(): Promise<void> {
    try {
      // 只保存 visits 配置，模型配置保存到 ModelManagementService
      const config = {
        visits: this.configVisits,
      };
      localStorage.setItem(this.CONFIG_KEY, JSON.stringify(config));
    } catch (error) {
      console.error('保存配置失败', error as Error | undefined);
    }
  }

  getConfigVisits(): number { return this.configVisits; }
  
  /**
   * 获取当前模型 ID
   * @description 从 ModelManagementService 读取全局模型配置
   */
  getConfigModel(): string {
    if (this.modelManager && typeof this.modelManager.getCurrentModel === 'function') {
      const modelId = this.modelManager.getCurrentModel();
      return modelId || DefaultModelService.getDefaultModelId();
    }
    return DefaultModelService.getDefaultModelId();
  }
  
  setConfigVisits(v: number): void { this.configVisits = v; }

  /**
   * 胜率图描绘的默认 visits（固定不可配）
   * 小模型(blocks≤6): 50, 中等模型(blocks≤10): 25, 大模型(blocks>10): 1
   */
  static getDefaultVisitsForModel(model: ModelConfig | null | undefined): number {
    const blocks = (model as any)?.blocks ?? 0;
    if (blocks > 0) {
      if (blocks <= 6) return 50;
      if (blocks <= 10) return 25;
      return 1;  // 大模型改回1
    }
    // blocks 未设置或 model 为空，尝试从 URL 文件名解析（如 g170-b6c96 → 6, kata1-b28c512 → 28）
    const url = (model as any)?.url ?? '';
    const match = url.match(/b(\d+)c/i);
    if (match) {
      const b = parseInt(match[1], 10);
      if (b <= 6) return 50;
      if (b <= 10) return 25;
      return 1;
    }
    return 1;  // 解析不出，默认 1
  }

  /**
   * 分析局面的默认 visits
   * 小模型(blocks≤6): 200, 中等模型(blocks≤10): 200, 大模型(blocks>10): 10
   */
  static getAnalysisVisitsForModel(model: ModelConfig | null | undefined): number {
    const blocks = (model as any)?.blocks ?? 0;
    if (blocks > 0) {
      if (blocks <= 10) return 200;  // 小模型和中模型统一200
      return 10;  // 大模型10
    }
    // blocks 未设置或 model 为空，尝试从 URL 文件名解析
    const url = (model as any)?.url ?? '';
    const match = url.match(/b(\d+)c/i);
    if (match) {
      const b = parseInt(match[1], 10);
      if (b <= 10) return 200;
      return 10;
    }
    return 200;  // 解析不出，默认200
  }
  
  /**
   * 获取自定义模型的 URL
   * @description 从 ModelManagementService 读取
   */
  async getCustomModelUrl(): Promise<string> {
    if (this.modelManager && typeof this.modelManager.loadCustomModelUrl === 'function') {
      return await this.modelManager.loadCustomModelUrl() || '';
    }
    return '';
  }
  /** 显示配置对话框 */
  async showConfigDialog(reviewApp: ReviewApp, modelManager?: any): Promise<void> {
    const dialog = document.createElement('div');
    dialog.className = 'config-dialog';
    
    // 获取模型列表
    let models: any[] = [];
    
    // 优先使用 ModelManagementService
    if (modelManager && typeof modelManager.getModels === 'function') {
      try {
        const modelList = await modelManager.getModels();
        console.log('[ReviewUI] Model list from ModelManagementService:', modelList);
        models = modelList;
      } catch (error) {
        console.error('[ReviewUI] Failed to load models from ModelManagementService:', error);
      }
    }
    
    // fallback: 从 modelManager 获取
    if (models.length === 0 && modelManager) {
      try {
        const modelList = await modelManager.getModels();
        console.log('[ReviewUI] Model list from modelManager:', modelList);
        models = modelList;
      } catch (error) {
        console.error('[ReviewUI] Failed to load models:', error);
        models = [DefaultModelService.getDefaultModelCard()];
      }
    }
    
    console.log('[ReviewUI] Models to display:', models);
    
    // 创建 ModelSelector 组件
    const modelSelector = new ModelSelector({
      modelManager: modelManager,  // 传入 modelManager，以便加载保存的偏好
      currentModelId: this.getConfigModel(),
    });
    
    // 手动设置模型列表
    (modelSelector as any).models = models;
    
    // 加载保存的偏好（包括自定义模型的 URL）
    try {
      await modelSelector.loadModels();
      console.log('[ReviewUI] ModelSelector loaded saved preferences');
    } catch (error) {
      console.error('[ReviewUI] Failed to load saved preferences:', error);
    }
    
    // 如果没有选中模型且有模型列表，默认选中第一个
    if (!modelSelector.getSelectedModelId() && models.length > 0) {
      (modelSelector as any).selectedModelId = models[0]!.id;
    }
    
    // 保存 modelSelector 实例，以便在点击"确定"时获取选中的模型
    (this as any).modelSelector = modelSelector;
    
    dialog.innerHTML = `
      <div class="dialog-overlay"></div>
      <div class="dialog-content">
        <h3>配置</h3>
        <div class="config-item">
          <label>计算量 (visits) <span style="font-weight: normal; font-size: 11px; color: #888;">（用于分析局面）</span></label>
          <div class="slider-row" style="margin: 10px 0;">
            <input type="range" id="configVisits" min="1" max="500" value="${this.configVisits}" step="1">
            <span id="visitsDisplay" class="slider-num" style="text-align: right; min-width: 32px;">${this.configVisits}</span>
          </div>
        </div>
        <div class="config-item">
          <label>AI 模型</label>
          ${modelSelector.render()}
        </div>
        <div class="dialog-buttons">
          <button class="dialog-cancel">取消</button>
          <button class="dialog-confirm">确定</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);

    // 绑定 ModelSelector 事件
    modelSelector.bindEvents(dialog);

    const visitsSlider = dialog.querySelector('#configVisits') as HTMLInputElement;
    const visitsDisplay = dialog.querySelector('#visitsDisplay') as HTMLElement;

    if (visitsSlider && visitsDisplay) {
      visitsSlider.addEventListener('input', () => { visitsDisplay.textContent = visitsSlider.value; });
    }
    
    return new Promise<void>((resolve) => {
      dialog.querySelector('.dialog-cancel')?.addEventListener('click', () => { dialog.remove(); resolve(); });
      dialog.querySelector('.dialog-confirm')?.addEventListener('click', async () => {
        const vs = dialog.querySelector('#configVisits') as HTMLInputElement;
        const ms = modelSelector.getSelectedModelId();
        if (vs) {
          this.configVisits = parseInt(vs.value, 10);
        }
        
        // 保存自定义模型的 URL
        let customUrl: string | undefined;
        if (ms === 'custom') {
          customUrl = modelSelector.getCustomModelUrl();
        }
        
        // 保存到 ReviewUI 的 localStorage
        this.saveConfig();
        
        // 保存到 ModelManagementService（全局模型配置）
        if (modelManager && typeof modelManager.savePreference === 'function') {
          try {
            await modelManager.savePreference(ms, customUrl);
            console.log('[ReviewUI] Saved model preference to ModelManagementService:', ms, customUrl);
          } catch (error) {
            console.error('[ReviewUI] Failed to save model preference:', error);
          }
        }
        
        dialog.remove();
        resolve();
      });
      dialog.querySelector('.dialog-overlay')?.addEventListener('click', () => { dialog.remove(); resolve(); });
    });
  }

  /** 读取文件内容 */
  readFileContent(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file);
    });
  }

  /** 设置按钮启用/禁用状态 */
  setButtonEnabled(buttonId: string, enabled: boolean): void {
    const button = document.getElementById(buttonId) as HTMLButtonElement | null;
    if (button) {
      button.disabled = !enabled;
      button.style.opacity = enabled ? '1' : '0.5';
      button.style.cursor = enabled ? 'pointer' : 'not-allowed';
    }
  }

  /** 禁用所有功能按钮（没有棋谱时） */
  disableAllButtons(): void {
    this.setButtonEnabled('prevMoveBtn', false);
    this.setButtonEnabled('nextMoveBtn', false);
    this.setButtonEnabled('analyzeBtn', false);
    this.setButtonEnabled('prevBadmoveBtn', false);
    this.setButtonEnabled('nextBadmoveBtn', false);
    this.setButtonEnabled('undoBtn', false);
  }

  /** 启用所有功能按钮（有棋谱时） */
  enableAllButtons(): void {
    // 分析局面模式：不启用导航控件（滑条、上一步、下一步）
    if (this.analyzePositionMode) {
      // 只启用AI按钮、undoBtn等非导航按钮
      this.setButtonEnabled('analyzeBtn', true);
      this.setButtonEnabled('undoBtn', true);
      return;
    }
    this.setButtonEnabled('prevMoveBtn', true);
    this.setButtonEnabled('nextMoveBtn', true);
    this.setButtonEnabled('analyzeBtn', true);
    this.setButtonEnabled('prevBadmoveBtn', true);
    this.setButtonEnabled('nextBadmoveBtn', true);
    this.setButtonEnabled('undoBtn', true);
  }

  /** 设置所有交互按钮的启用/禁用状态（分析时禁用） */
  setButtonsEnabled(enabled: boolean): void {
    const buttonIds = ['prevBtn', 'nextBtn', 'aiBtn', 'aiRecommendBtn', 'undoBtn'];
    buttonIds.forEach(id => {
      // 分析局面模式：不启用导航按钮（prevBtn、nextBtn）
      if (this.analyzePositionMode && (id === 'prevBtn' || id === 'nextBtn')) {
        return; // 跳过，保持禁用状态
      }
      this.setButtonEnabled(id, enabled);
    });
    
    // 禁用滑块
    if (this.moveSlider) {
      // 分析局面模式：滑块保持禁用
      if (this.analyzePositionMode) {
        this.moveSlider.disabled = true;
        this.moveSlider.style.opacity = '0.3';
      } else {
        this.moveSlider.disabled = !enabled;
        this.moveSlider.style.opacity = enabled ? '1' : '0.5';
      }
    }
  }
}
