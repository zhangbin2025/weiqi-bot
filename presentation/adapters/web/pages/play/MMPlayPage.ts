/**
 * AI自对弈页面
 * @module presentation/pages/play/MMPlayPage
 */

import { AdapterFactory } from '../../../../adapters';
import { WebAudioPlayer } from '../../../../../infrastructure/audio/WebAudioPlayer';
import type { IPage, IBoard, ICard, IToast, IProgress, PageParams } from '../../../../core/interfaces';
import type { MMPlayApp } from '../../../../../application/play';
import type { Position, PlayerColor, BoardSize } from '../../../../core/types';
import type { PlaySpeed } from '../../../../../services/play/mm/types';
import type { MMGameEndResult, MMGameState } from './constants/MMConstants';
import { DefaultModelService } from '../../../../../services/model';
import { renderMMState, updatePlayerIndicator, updateStatus } from './MMPlayRenderer';
import { MMPlayPageUIState } from './MMPlayPageUIState';
import { MMEventBinder } from './controllers/MMEventBinder';
import { MMUIUpdater } from './ui/MMUIUpdater';
import { showLoading, updateProgress, hideLoading, setLoadingText, setInitProgress } from '../../../../../clients/web/play/shared/ProgressManager';
import { getWebRoot } from '../../../../../infrastructure/utils/web/pathUtils';

export interface MMPlayPageConfig {
  mmPlayApp: MMPlayApp;
  logger?: any;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
  onShowSettingsDialog?: () => void;
  kataGoEngine?: any;
  historyManager?: any;
  modelManager?: any;  // ModelManagementService
}

/**
 * AI自对弈页面
 */
export class MMPlayPage implements IPage {
  readonly title = 'AI自对弈';
  
  private mmPlayApp: MMPlayApp;
  private logger?: any;
  private onNavigate?: ((page: string, params?: Record<string, string>) => void) | undefined;
  private onShowSettingsDialog: (() => void) | undefined;
  private board: IBoard;
  private card: ICard;
  private toast: IToast;
  private progress: IProgress;
  private audioPlayer: WebAudioPlayer;
  
  private running = false;
  private moveCount = 0;
  private modelId?: string;
  private boardSize: BoardSize = 19;
  private speed: PlaySpeed = 'normal';
  private initialized = false;
  private uiState = new MMPlayPageUIState();
  
  // 新增属性
  private gameState: MMGameState = 'idle';
  private currentOptions: any = null;
  private kataGoEngine?: any;
  private historyManager?: any;
  private modelManager?: any;  // ModelManagementService
  private modelCards: Array<{ id: string; name: string; size: string }> = [];
  
  // 子模块
  private eventBinder?: MMEventBinder;
  private uiUpdater?: MMUIUpdater;

  constructor(config: MMPlayPageConfig) {
    this.mmPlayApp = config.mmPlayApp;
    this.logger = config.logger;
    this.onNavigate = config.onNavigate;
    this.onShowSettingsDialog = config.onShowSettingsDialog;
    this.kataGoEngine = config.kataGoEngine;
    this.historyManager = config.historyManager;
    this.modelManager = config.modelManager;
    
    this.board = AdapterFactory.createBoard();
    this.card = AdapterFactory.createCard();
    this.toast = AdapterFactory.createToast();
    this.progress = AdapterFactory.createProgress();
    this.audioPlayer = new WebAudioPlayer();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    this.board.initialize({ size: this.boardSize, showCoordinates: true });
    await this.loadModel();
    
    // 初始化子模块
    this.initSubModules();
    
    // 设置回调监听自对弈落子
    this.mmPlayApp.setCallbacks({
      onMove: (x: number, y: number, color: PlayerColor, moveNum: number, captured?: Array<{x: number; y: number}>) => {
        // 处理 pass（停一手）
        if (x === -1 && y === -1) {
          updateStatus(`${color === 'black' ? '黑方' : '白方'} 停一手`);
          return;
        }
        
        this.moveCount++;
        this.board.placeStone({ x, y }, color);
        
        // 处理提子
        if (captured && captured.length > 0) {
          for (const cap of captured) {
            this.board.removeStone({ x: cap.x, y: cap.y });
          }
        }
        
        // 标记最后一手
        this.board.clearHighlight();
        this.board.highlight({ x, y }, 'last');
        
        // 播放音效
        if (captured && captured.length > 0) {
          this.audioPlayer.play('capture').catch(() => {});
        } else {
          this.audioPlayer.play('stone').catch(() => {});
        }
        
        this.board.render();
        
        // 立即更新手数和提子数显示
        const state = this.mmPlayApp.getState();
        this.renderStats(state);
      },
      onPlayerChange: (player: PlayerColor) => {
        updatePlayerIndicator(player);
        updateStatus(`${player === 'black' ? '黑方' : '白方'}AI 思考中...`);
      },
      onGameEnd: async () => {
        this.running = false;
        this.toast.success('自对弈结束');
        await this.handleGameEnd();
        this.render();
        updateStatus('对局已结束');
        
        // 隐藏暂停按钮
        const pauseBtn = document.getElementById('pauseBtn');
        if (pauseBtn) {
          pauseBtn.style.display = 'none';
        }
      },
    });
    
    this.initialized = true;
    
    // 检查草稿
    const draft = await this.mmPlayApp.loadDraft();
    if (draft && !draft.gameEnded && draft.moveHistory.length > 0) {
      this.showDraftRecoveryDialog(draft);
      this.uiState.setHasDraft(true);
    } else {
      this.uiState.setHasDraft(false);
    }
  }

  handleParams(_params: PageParams): void {}

  /**
   * 初始化子模块
   */
  private initSubModules(): void {
    this.uiUpdater = new MMUIUpdater({
      kataGoEngine: this.kataGoEngine,
      modelCards: this.modelCards,
    });
    
    this.eventBinder = new MMEventBinder({
      mmPlayApp: this.mmPlayApp,
      getGameState: () => this.gameState,
      setGameState: (state) => this.setGameState(state as MMGameState),
      showSituationDialog: () => this.showSituationDialog(),
      handleEarlyStop: () => this.handleEarlyStop(),
    });
    
    // 绑定所有事件
    this.eventBinder.bindAllEvents();
    
    // 监听显示设置对话框事件
    window.addEventListener('showSettingsDialog', () => {
      if (this.onShowSettingsDialog) {
        this.onShowSettingsDialog();
      }
    });
  }

  private async loadModel(): Promise<void> {
    try {
      this.progress.show();
      this.progress.setValue(0);
      this.progress.setConfig({ showLabel: true });
      this.progress.render();
      
      const modelList = await this.mmPlayApp.loadModels();
      const models = await this.mmPlayApp.getModels();
      
      if (models.length > 0) {
        this.modelId = models[0]!.id;
      }
      
      // 加载模型列表
      this.modelCards = models.map(m => ({ id: m.id, name: m.name, size: m.size }));
      
      this.progress.setValue(100);
      this.progress.render();
      setTimeout(() => this.progress.hide(), 500);
    } catch (error) {
      this.toast.error('模型加载失败');
      this.progress.hide();
    }
  }

  /**
   * 开始自对弈
   */
  async startAutoPlay(options: any): Promise<void> {
    try {
      this.currentOptions = options;
      this.setGameState('loading');
      
      // 显示 loading
      showLoading('正在加载模型...');
      
      // 给浏览器一点时间更新 UI，避免阻塞
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // 使用 ModelManagementService 切换模型（如果可用）
      if (this.modelManager) {
        // 获取模型 URL
        let modelUrl: string | undefined;
        if (options.modelId === 'custom') {
          // 自定义模型：优先使用传入的 URL
          if (options.modelUrl) {
            modelUrl = options.modelUrl;  // 使用对话框传入的 URL
          } else if (typeof this.modelManager.loadCustomModelUrl === 'function') {
            // 如果没有传入，从存储加载
            modelUrl = (await this.modelManager.loadCustomModelUrl()) ?? undefined;
          }
          
          // 如果没有 URL，给出明确错误提示
          if (!modelUrl) {
            hideLoading();
            this.setGameState('idle');
            this.toast.error('请先在设置中输入自定义模型的 URL');
            this.uiUpdater?.updateStatusBar('缺少模型 URL');
            return;
          }
        } else {
          // 内置模型：构造本地路径
          const webRoot = this.getWebRoot();
          modelUrl = `${webRoot}models/${options.modelId}.bin.gz`;
        }
        
        // 使用 ModelManagementService 切换模型（先保存偏好，再加载）
        await this.modelManager.switchModel(options.modelId, modelUrl, (loaded: number, total: number, progress: number) => {
          updateProgress(loaded, total, progress);
        }, (info: { stage: string; message: string; current?: number; total?: number }) => {
          // KataGo 初始化进度（tuning）
          setInitProgress(info.message || '');
        });
      }
      
      setLoadingText('正在启动对局...');

      // 初始化对局（模型已经通过 modelManager.switchModel() 加载）
      // 不传递 modelUrl 和 onProgress，避免重复加载
      await this.mmPlayApp.setup({
        modelId: options.modelId,
        visits: options.visits,
        speed: options.speed,
      });
      
      await this.mmPlayApp.start();
      
      hideLoading();
      this.setGameState('running');
      
      // 更新标题栏模型信息
      this.uiUpdater?.updateModelInfo(options.modelId, options.visits, options.speed);
      
      // 显示后端信息
      this.uiUpdater?.showBackendInfo();
      
      this.render();
    } catch (error) {
      hideLoading();
      this.setGameState('idle');
      this.toast.error('启动自对弈失败');
      this.uiUpdater?.updateStatusBar('启动失败');
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    try {
      await this.mmPlayApp.setup({
        modelId: this.modelId || 'default',
        visits: 100,
        speed: this.speed,
      });
      await this.mmPlayApp.start();
      this.running = true;
      this.moveCount = 0;
      this.board.clear();
      this.board.render();
      this.toast.success('自对弈开始');
      this.render();
    } catch (error) {
      this.toast.error('启动失败');
    }
  }

  pause(): void {
    if (!this.running) return;
    this.mmPlayApp.pause();
    this.running = false;
    this.toast.info('已暂停');
    this.render();
  }

  resume(): void {
    if (this.running) return;
    this.mmPlayApp.resume();
    this.running = true;
    this.toast.info('继续运行');
    this.render();
  }

  async stop(): Promise<void> {
    if (!this.running && this.moveCount === 0) return;
    this.mmPlayApp.stop();
    this.running = false;
    try {
      await this.mmPlayApp.saveToHistory();
      this.toast.success('已保存');
    } catch (error) {
      // 保存失败
    }
    this.render();
  }

  setSpeed(speed: PlaySpeed): void {
    this.speed = speed;
    this.toast.info(`速度: ${speed}`);
  }

  render(): void {
    this.board.clear();
    
    // 渲染棋子
    const state = this.mmPlayApp.getState();
    const board = state.board;
    const size = board.length;
    
    for (let y = 0; y < size; y++) {
      const row = board[y];
      if (!row) continue;
      for (let x = 0; x < row.length; x++) {
        const stone = row[x];
        if (stone) {
          this.board.placeStone({ x, y }, stone as PlayerColor);
        }
      }
    }
    
    // 标记最后一手
    const moveHistory = state.moveHistory;
    if (moveHistory.length > 0) {
      const lastMove = moveHistory[moveHistory.length - 1];
      if (lastMove) {
        this.board.highlight({ x: lastMove.x, y: lastMove.y }, 'last');
      }
    }
    
    this.board.render();
    
    // 更新统计信息
    this.renderStats(state);
    
    renderMMState(this.card, {
      running: this.running,
      moveCount: this.moveCount,
      modelId: this.modelId,
    });
  }

  /**
   * 更新统计信息（手数、提子数）
   */
  private renderStats(state: any): void {
    this.uiUpdater?.updateMoveCount(state.currentMove);
    this.uiUpdater?.updateCaptures(state.capturedBlack || 0, state.capturedWhite || 0);
  }

  /**
   * 设置游戏状态
   */
  private setGameState(state: MMGameState): void {
    this.gameState = state;
    this.uiUpdater?.updateButtonStates(state);
    this.uiUpdater?.updateStatusBarFromState(state);
  }

  /**
   * 从 MMPlayApp 同步状态
   */
  syncStateFromApp(): void {
    try {
      const appState = this.mmPlayApp.getState();
      
      if (appState.isRunning && !appState.isPaused) {
        if (this.gameState !== 'running') {
          this.setGameState('running');
          this.uiUpdater?.updateStatusBar(appState.currentPlayer === 'black' ? '黑方 AI 思考中...' : '白方 AI 思考中...');
          this.uiUpdater?.showBackendInfo();
        }
      } else if (appState.isPaused) {
        if (this.gameState !== 'paused') {
          this.setGameState('paused');
        }
      } else if (appState.gameEnded) {
        if (this.gameState !== 'ended') {
          // 先设置状态，防止重复调用
          this.setGameState('ended');
          // 对局结束，触发结束流程（数子、弹框、保存）
          this.handleGameEnd();
        }
      }
    } catch (error) {
      // 忽略错误
    }
  }

  /**
   * 显示形势判断弹框
   */
  private async showSituationDialog(): Promise<void> {
    const dialog = document.getElementById('situationDialog');
    const winRateEl = document.getElementById('winRate');
    const scoreDiffEl = document.getElementById('scoreDiff');
    const noteEl = document.getElementById('situationNote');
    
    if (!dialog || !winRateEl || !scoreDiffEl || !noteEl) return;
    
    dialog.style.display = 'flex';
    winRateEl.textContent = '分析中...';
    scoreDiffEl.textContent = '分析中...';
    noteEl.textContent = 'KataGo 正在计算...';
    
    try {
      const result = await this.mmPlayApp.analyzePosition();
      
      winRateEl.textContent = `${(result.winRate * 100).toFixed(1)}%`;
      
      if (result.scoreLead > 0) {
        scoreDiffEl.textContent = `黑领先 ${result.scoreLead.toFixed(1)} 目`;
      } else {
        scoreDiffEl.textContent = `白领先 ${Math.abs(result.scoreLead).toFixed(1)} 目`;
      }
      
      noteEl.textContent = result.winRate > 0.5 ? '黑方形势占优' : '白方形势占优';
    } catch (error) {
      winRateEl.textContent = '分析失败';
      scoreDiffEl.textContent = '--';
      noteEl.textContent = '请检查 KataGo 是否正常运行';
    }
  }

  /**
   * 处理提前结束
   */
  private async handleEarlyStop(): Promise<void> {
    if (this.gameState === 'running') {
      this.mmPlayApp.pause();
    }
    
    const confirmed = await this.showConfirmDialog('提前结束对局？', 'AI 将进行数目判断胜负。');
    
    if (!confirmed) {
      if (this.gameState === 'paused') {
        this.mmPlayApp.resume();
        this.setGameState('running');
      }
      return;
    }
    
    await this.executeGameEnd();
  }

  /**
   * 显示确认对话框
   */
  private showConfirmDialog(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const dialog = document.getElementById('confirmDialog');
      const titleEl = document.getElementById('confirmTitle');
      const messageEl = document.getElementById('confirmMessage');
      const cancelBtn = document.getElementById('confirmCancelBtn');
      
      if (!dialog || !titleEl || !messageEl) {
        resolve(false);
        return;
      }
      
      titleEl.textContent = title;
      messageEl.textContent = message;
      dialog.style.display = 'flex';
      
      const handleOk = () => {
        resolve(true);
        window.removeEventListener('confirmOk', handleOk);
      };
      
      const handleCancel = () => {
        resolve(false);
        window.removeEventListener('confirmOk', handleOk);
      };
      
      window.addEventListener('confirmOk', handleOk, { once: true });
      cancelBtn?.addEventListener('click', handleCancel, { once: true });
    });
  }

  /**
   * 执行对局结束流程
   */
  private async executeGameEnd(): Promise<void> {
    this.uiUpdater?.updateStatusBar('AI 正在数目...');
    
    let result: MMGameEndResult | null = null;
    
    try {
      const scoreResult = await this.mmPlayApp.finalScore();
      const state = this.mmPlayApp.getState();
      const moveCount = state.moveHistory.length;
      
      result = {
        winner: scoreResult.winner,
        margin: scoreResult.margin,
        sgfResult: scoreResult.sgfResult,
        moveCount,
      };
    } catch (error) {
      // 数子失败，使用默认结果
      const state = this.mmPlayApp.getState();
      result = {
        winner: 'black' as const,
        margin: 0,
        sgfResult: 'B+0',
        moveCount: state.moveHistory.length,
      };
    }
    
    try {
      // 无论如何都保存对局
      await this.saveGame(result);
      await this.mmPlayApp.clearDraft();
    } catch (error) {
      // 保存失败
    }
    
    // 显示结果弹框
    this.uiUpdater?.showGameEndDialog(result, this.currentOptions);
    this.setGameState('ended');
  }

  /**
   * 处理游戏结束
   */
  private async handleGameEnd(): Promise<void> {
    await this.executeGameEnd();
  }

  /**
   * 保存棋谱
   */
  private async saveGame(result: MMGameEndResult): Promise<void> {
    try {
      const sgf = this.mmPlayApp.exportSgf();
      const state = this.mmPlayApp.getState();
      
      if (this.historyManager) {
        await this.historyManager.saveToHistory(
          sgf,
          {
            moveHistory: state.moveHistory,
            board: { size: state.board.length },
          },
          {
            blackName: '黑方 AI',
            whiteName: '白方 AI',
          }
        );
      }
    } catch (error) {
      // 保存失败
    }
  }

  /**
   * 显示草稿恢复对话框
   */
  private async showDraftRecoveryDialog(draft: any): Promise<void> {
    const container = document.getElementById('dialogContainer');
    if (!container) return;
    
    container.innerHTML = `
      <div class="dialog-overlay" style="display: flex;">
        <div class="dialog">
          <div class="dialog-title">恢复对局</div>
          <div style="text-align: center; margin-bottom: 20px; color: #666;">
            发现未完成的自对弈（手数: ${draft.moveCount}），是否继续？
          </div>
          <div class="dialog-btn-group">
            <button class="dialog-btn primary" id="restoreDraftBtn">继续对局</button>
            <button class="dialog-btn secondary" id="newGameBtn">开始新局</button>
          </div>
        </div>
      </div>
    `;
    
    document.getElementById('restoreDraftBtn')?.addEventListener('click', async () => {
      container.innerHTML = '';
      await this.restoreFromDraft(draft);
    });
    
    document.getElementById('newGameBtn')?.addEventListener('click', async () => {
      container.innerHTML = '';
      await this.mmPlayApp.clearDraft();
      if (this.onShowSettingsDialog) {
        this.onShowSettingsDialog();
      }
    });
  }

  /**
   * 从草稿恢复
   */
  private async restoreFromDraft(draft: any): Promise<void> {
    try {
      const modelId = draft.modelId || DefaultModelService.getDefaultModelId();
      const visits = draft.visits || 100;
      const speed = (draft.speed || 'normal') as PlaySpeed;
      
      this.modelId = modelId;
      this.speed = speed;
      
      // 使用 ModelManagementService 切换模型（如果有）
      // 构造模型 URL（和新开棋局逻辑一致）
      // 构造模型 URL：优先使用草稿中保存的 URL
      let modelUrl: string | undefined = draft.modelUrl;
      if (!modelUrl && modelId === 'custom') {
        if (typeof this.modelManager?.loadCustomModelUrl === 'function') {
          modelUrl = (await this.modelManager.loadCustomModelUrl()) ?? undefined;
        }
        if (!modelUrl) {
          this.toast.error('自定义模型 URL 丢失，请开始新局');
          return;
        }
      }
      if (!modelUrl) {
        const webRoot = this.getWebRoot();
        modelUrl = `${webRoot}models/${modelId}.bin.gz`;
      }
      
      if (this.modelManager && this.modelManager.getCurrentModel() !== modelId) {
        // 需要切换模型，显示进度
        showLoading('正在加载模型...');
        await this.modelManager.switchModel(modelId, modelUrl, (loaded: number, total: number, progress: number) => {
          updateProgress(loaded, total, progress);
        }, (info: { stage: string; message: string; current?: number; total?: number }) => {
          setInitProgress(info.message || '');
        });
        hideLoading();
      }
      
      // 初始化对局（传入 modelUrl，防止进程关闭后重新初始化时用错误的 URL）
      await this.mmPlayApp.setup({
        modelId,
        visits,
        speed,
      }, modelUrl);
      
      await this.mmPlayApp.restoreFromDraft(draft);
      this.moveCount = draft.moveCount;
      this.running = true;
      
      const modelInfoEl = document.getElementById('modelInfo');
      if (modelInfoEl && this.modelId) {
        const model = this.modelCards.find(m => m.id === this.modelId);
        const modelName = model?.name || this.modelId;
        modelInfoEl.textContent = `${modelName} · ${visits} visits · ${speed}`;
      }
      
      this.render();
      // 显示引擎信息
      this.uiUpdater?.showBackendInfo();
      await this.mmPlayApp.start();
      
      const pauseBtn = document.getElementById('pauseBtn');
      if (pauseBtn) {
        pauseBtn.style.display = 'flex';
        pauseBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16">
            <rect x="6" y="4" width="4" height="16"/>
            <rect x="14" y="4" width="4" height="16"/>
          </svg>
        `;
      }
      
      this.toast.info('对局已恢复');
    } catch (error) {
      hideLoading();
      this.toast.error('恢复对局失败');
    }
  }

  /**
   * 检查是否有未完成的对局草稿
   */
  hasDraftToRecover(): boolean {
    return this.uiState.hasDraftToRecover();
  }

  /**
   * 获取 Web Root
   */
  private getWebRoot(): string {
    return getWebRoot();
  }

  destroy(): void {
    this.board.destroy();
    this.card.destroy();
    this.toast.destroy();
    this.progress.destroy();
    this.initialized = false;
  }
}
