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
}

/**
 * 复盘 UI 管理器
 *
 * 管理 DOM 元素引用、事件绑定、菜单、配置对话框等 UI 操作。
 */
export class ReviewUI {
  private callbacks: UICallbacks;

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
  private depthCellsEl: HTMLElement | null = null;
  private depthCountEl: HTMLElement | null = null;

  // 配置
  private configVisits = 200;  // 默认分析局面用
  private modelManager: any = null;  // ModelManagementService 引用
  private readonly CONFIG_KEY = 'review-config';

  // 音效
  private soundEnabled = true;

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
      depthCellsEl: this.depthCellsEl,
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
    this.depthCellsEl = document.getElementById('depthCells');
    this.depthCountEl = document.getElementById('depthCount');
    this.setupMenu();
  }

  /** 绑定事件 */
  bindEvents(): void {
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
    const chartContainer = document.getElementById('chart-container');
    if (chartContainer) chartContainer.style.display = show ? 'block' : 'none';
  }

  updateDepthIndicator(depth: number, maxDepth: number): void {
    if (!this.depthCellsEl || !this.depthCountEl) return;
    const displayCells = maxDepth;
    let cellsHtml = '';
    for (let i = 0; i < displayCells; i++) {
      const active = i < depth ? 'active' : '';
      cellsHtml += `<div class="depth-cell ${active}"></div>`;
    }
    this.depthCellsEl.innerHTML = cellsHtml;
    this.depthCountEl.textContent = `${depth}`;
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

  showHistory(): void {
    window.location.href = '../replay/list.html?category=review&key=all';
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
    this.setButtonEnabled('prevMoveBtn', true);
    this.setButtonEnabled('nextMoveBtn', true);
    this.setButtonEnabled('analyzeBtn', true);
    this.setButtonEnabled('prevBadmoveBtn', true);
    this.setButtonEnabled('nextBadmoveBtn', true);
    this.setButtonEnabled('undoBtn', true);
  }
}
