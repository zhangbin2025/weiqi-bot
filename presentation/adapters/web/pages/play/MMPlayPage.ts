/**
 * AI自对弈页面
 * @module presentation/pages/play/MMPlayPage
 */

import { AdapterFactory } from '../../../../adapters';
import { computeTerritoryStats, territoryVisitsForModel, type TerritoryStats } from '../../../../../services/ai/TerritoryStats';
import { showTerritoryPanel, hideTerritoryPanel, injectTerritoryPanelCss } from '../../components/TerritoryPanel';
import { komiForHandicap } from '../../../../../domain';
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
  /** 最新的领地归属数据（AI 每次搜索后更新，复用 MCTS 结果） */
  /** 形势快照的领地归属；仅在面板显示期间非空（一次性查看，非模式） */
  private ownership: Float32Array | null = null;
  /** 是否正在显示形势面板 */
  private territoryVisible: boolean = false;
  
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
    injectTerritoryPanelCss();
    
    this.board.initialize({ size: this.boardSize, showCoordinates: true });
    await this.loadModel();
    
    // 初始化子模块
    this.initSubModules();
    
    // 设置回调监听自对弈落子
    this.mmPlayApp.setCallbacks({
      onMove: (x: number, y: number, color: PlayerColor, moveNum: number, captured?: Array<{x: number; y: number}>, winRate?: number, scoreLead?: number, ownership?: Float32Array) => {
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
        
        // 保存领地归属（MCTS 搜索的副产品，不额外消耗 visits）
        // setOwnership 内部已同步到棋盘，本手重绘即可用上新归属
        // 仅形势面板显示期间保留；否则清空，避免旧归属残留到下一手
        if (ownership && this.territoryVisible) {
          this.ownership = ownership;
          this.syncOwnershipToBoard();
          this.updateTerritoryButton();
        }

        this.renderBoardWithTerritory();

        // 立即更新手数和提子数显示
        const state = this.mmPlayApp.getState();
        this.renderStats(state);

        // 更新副标题显示胜率和目差
        if (winRate !== undefined && scoreLead !== undefined) {
          this.updateSubtitleWithScore(winRate, scoreLead);
        }
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
      handleEarlyStop: () => this.handleEarlyStop(),
      onShowTerritory: () => this.showTerritoryOnce(),
    });
    
    // 绑定所有事件
    this.eventBinder.bindAllEvents();
    
    // 监听显示设置对话框事件
    window.addEventListener('showSettingsDialog', () => {
      this.dismissTerritoryIfVisible();
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
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('远程服务端不在线')) {
        this.toast.error('远程服务端不在线，无法获取模型列表');
      } else {
        this.toast.error('模型加载失败');
      }
      this.progress.hide();
    }
  }

  /**
   * 开始自对弈
   */
  async startAutoPlay(options: any): Promise<void> {
    try {
      this.currentOptions = options;
      // 新对局：清空上一局的领地数据与显示开关，避免显示过期归属
      this.resetTerritory();
      this.setGameState('loading');
      
      // 显示 loading
      showLoading('正在加载模型...');
      
      // 给浏览器一点时间更新 UI，避免阻塞
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // 使用 ModelManagementService 切换模型（如果可用）
      let modelUrl: string | undefined;
      if (this.modelManager) {
        // 获取模型 URL
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
      }, modelUrl || undefined);  // 传递 modelUrl 以便保存到草稿
      
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
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('远程服务端不在线') || errMsg.includes('隧道未连接')) {
        this.toast.error('远程服务端不在线，请检查服务端是否已启动');
        this.uiUpdater?.updateStatusBar('服务端不在线');
      } else {
        this.toast.error('启动自对弈失败: ' + errMsg);
        this.uiUpdater?.updateStatusBar('启动失败');
      }
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
      this.resetTerritory();
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
    this.dismissTerritoryIfVisible();
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

    this.renderBoardWithTerritory();

    // 更新统计信息
    this.renderStats(state);
    
    renderMMState(this.card, {
      running: this.running,
      moveCount: this.moveCount,
      modelId: this.modelId,
    });
  }

  /**
   * 把领地归属写入棋盘（只写不渲染）
   * @description 棋盘内部缓存着自己的归属副本，只有 setOwnership 能更新它。
   * 与渲染解耦后，写入时机可以自由安排，不会因调用顺序而丢失更新。
   */
  private syncOwnershipToBoard(): void {
    const boardImpl = this.board as { setOwnership?: (o: Float32Array | number[] | null) => void };
    if (!boardImpl.setOwnership) return;
    boardImpl.setOwnership(this.territoryVisible && this.ownership ? this.ownership : null);
  }

  /**
   * 把领地归属写入棋盘并重绘
   */
  private renderBoardWithTerritory(): void {
    this.syncOwnershipToBoard();
    this.board.render();
  }

  /**
   * 更新统计信息（手数、提子数）
   */
  private renderStats(state: any): void {
    this.uiUpdater?.updateMoveCount(state.currentMove);
    this.uiUpdater?.updateCaptures(state.capturedBlack || 0, state.capturedWhite || 0);
  }

  /**
   * 更新副标题显示胜率和目差
   */
  private updateSubtitleWithScore(blackWinRate: number, blackScoreLead: number): void {
    const subtitle = document.getElementById('modelInfo');
    if (!subtitle) return;
    
    const blackPercent = Math.round(blackWinRate * 100);
    const leader = blackScoreLead > 0 ? '黑' : '白';
    const lead = Math.abs(blackScoreLead).toFixed(1);
    
    // 保留模型信息前缀，追加胜率信息
    const baseText = this.getModelInfoBaseText();
    subtitle.textContent = `${baseText} | ${leader}领先${lead}目 黑胜率${blackPercent}%`;
  }

  /**
   * 获取模型信息基础文本（不含胜率）
   */
  private getModelInfoBaseText(): string {
    if (this.currentOptions) {
      const model = this.modelCards.find(m => m.id === this.currentOptions.modelId);
      const modelName = model?.name || this.currentOptions.modelId;
      const speed = this.currentOptions.speed || 'normal';
      return `${modelName} · ${this.currentOptions.visits} visits`;
    }
    return this.modelId || 'AI自对弈';
  }

  /**
   * 形势：一次性查看（非模式）
   *
   * @description 点菜单 → 独立 analyze 一次（visits 按模型规模分档，图快）
   * → 画领地 + 显示统计面板。任何其它操作都会关闭。
   */
  async showTerritoryOnce(): Promise<void> {
    if (this.territoryVisible) {
      this.closeTerritory();
      return;
    }
    // 按钮始终可点，但未开局/加载中时引擎尚未就绪 → 明确提示
    if (this.gameState === 'idle' || this.gameState === 'loading') {
      this.toast.info('请先开始对局');
      return;
    }
    // App 原生 KataGo 必须显式请求才返回 ownership（额外 NN 计算）→ 用完即关
    this.mmPlayApp.setOwnershipRequested(true);
    try {
      const visits = this.getTerritoryVisits();
      const result = await this.mmPlayApp.analyzePosition({ visits });
      const ownership = result?.ownership;
      if (!ownership) {
        this.toast.info('未能获取形势数据');
        return;
      }
      this.ownership = ownership instanceof Float32Array ? ownership : new Float32Array(ownership);
      this.territoryVisible = true;
      this.renderBoardWithTerritory();

      const stats = this.buildTerritoryStats(this.ownership);
      if (!stats) {
        this.closeTerritory();
        this.toast.info('未能获取形势数据');
        return;
      }
      showTerritoryPanel(stats, { onClose: () => this.closeTerritory() });
    } catch (e) {
      console.error('[MMPlayPage] 形势分析失败', e as Error | undefined);
      this.toast.info('未能获取形势数据');
    } finally {
      this.mmPlayApp.setOwnershipRequested(false);
    }
  }

  /** 关闭形势（× 按钮与其它操作共用同一路径） */
  private closeTerritory(): void {
    this.territoryVisible = false;
    this.ownership = null;
    hideTerritoryPanel();
    this.renderBoardWithTerritory();
  }

  /** 任何交互前调用：正在看形势就先关掉 */
  private dismissTerritoryIfVisible(): void {
    if (this.territoryVisible) this.closeTerritory();
  }

  /** 形势分析 visits：小模型 50 / 大模型 10 */
  private getTerritoryVisits(): number {
    const model = this.modelCards.find(m => m.id === this.modelId);
    return territoryVisitsForModel(model ?? null);
  }

  /** 组装统计：mm 为分先对局，komi 恒为基础贴目 */
  private buildTerritoryStats(ownership: Float32Array): TerritoryStats | null {
    const st = this.mmPlayApp.getState?.() as { capturedBlack?: number; capturedWhite?: number } | undefined;
    return computeTerritoryStats({
      ownership,
      boardSize: this.boardSize,
      capturedBlack: st?.capturedBlack ?? 0,
      capturedWhite: st?.capturedWhite ?? 0,
      komi: komiForHandicap(0),
    });
  }

  /** 新对局开始：清空上一局的领地数据，避免显示过期归属 */
  private resetTerritory(): void {
    this.ownership = null;
    this.territoryVisible = false;
    hideTerritoryPanel();
    this.syncOwnershipToBoard();
    this.updateTerritoryButton();
  }

  /**
   * 更新形势菜单项的显示状态
   * @description 不再禁用 —— 一次性动作，任何时刻都可点；
   * 不满足条件时由 showTerritoryOnce 给出提示。
   */
  private updateTerritoryButton(): void {
    const btn = document.getElementById('menuTerritoryBtn') as HTMLButtonElement | null;
    if (!btn) return;
    btn.disabled = false;
    const label = btn.querySelector('span');
    if (label) label.textContent = '形势';
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
    
    // eslint-disable-next-line no-useless-assignment
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
      const sgf = this.mmPlayApp.exportSgf(result.sgfResult);
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
