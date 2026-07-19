/**
 * 人机对弈页面
 * @module presentation/pages/play/HMPlayPage
 */
import { AdapterFactory } from '../../../../adapters';
import { WebAudioPlayer } from '../../../../../infrastructure/audio/WebAudioPlayer';
import type { IPage, IBoard, ICard, IDialog, IToast, IProgress, PageParams } from '../../../../core/interfaces';
import type { HMPlayApp, PlayHistoryEntry } from '../../../../../application/play';
import type { PlayerColor, BoardSize, Position } from '../../../../core/types';
import { DefaultModelService } from '../../../../../services/model';
import { renderPlayState, renderSituation } from './HMPlayRenderer';
import { createHMPlayCallbacks } from './HMPlayPageCallbacks';
import { updatePlayerIndicator, updateStatus, updateButtons, showGameEndDialog, updateStats } from './HMPlayPageHelpers';
import { HMPlayPageUIState } from './HMPlayPageUIState';
import { HMEventBinder } from './controllers/HMEventBinder';
import { LocalStorageAdapter } from '../../../../../infrastructure/storage/adapters/web/LocalStorageAdapter';
import { HMUIUpdater } from './ui/HMUIUpdater';
import { ModelSelector } from '../../components/ModelSelector';
export interface HMPlayPageConfig {
  hmPlayApp: HMPlayApp;
  historyManager: any;
  game: any;
  kataGoEngine: any;
  progressManager: {
    showLoading: (text: string) => void;
    updateProgress: (loaded: number, total: number, progress: number) => void;
    setInitProgress: (message: string) => void;
    hideLoading: () => void;
  };
  modelManager?: any;  // ModelManagementService
  onNavigate?: (page: string, params?: Record<string, string>) => void;
  onShowOptionsDialog?: () => void;
  onUpdateButtons?: (isPlayerTurn: boolean, gameEnded: boolean, canUndo: boolean) => void;
  onUpdateTitleBar?: (playerColor: PlayerColor) => void;
}

/** 游戏状态 */
export type GameState = 'idle' | 'loading' | 'running' | 'ended';

/** 游戏选项 */
export interface GameOptions {
  visits: number;
  playerColor: PlayerColor;
  handicap: number;
  modelId: string;
  noUndo: boolean;
}

/** 模型卡片 */
export interface ModelCard {
  id: string;
  name: string;
  size: string;
}
export class HMPlayPage implements IPage {
  readonly title = '人机对弈';
  private hmPlayApp: HMPlayApp;
  private modelManager: any;  // ModelManagementService
  private onNavigate: ((page: string, params?: Record<string, string>) => void) | undefined;
  private onShowOptionsDialog: (() => void) | undefined;
  private onUpdateButtons: ((isPlayerTurn: boolean, gameEnded: boolean, canUndo: boolean) => void) | undefined;
  private onUpdateTitleBar: ((playerColor: PlayerColor) => void) | undefined;
  private globalClickListener: ((e: MouseEvent) => void) | undefined;
  private board: IBoard;
  private dialog: IDialog;
  private toast: IToast;
  private progress: IProgress;
  private audioPlayer: WebAudioPlayer;
  private playerColor: PlayerColor = 'black';
  private visits: number = 100;  // 默认计算量
  // private difficulty: number = 5;  // 已移除，改用 visits
  private boardSize: BoardSize = 19;
  private moveCount: number = 0;
  private uiState = new HMPlayPageUIState();
  private initialized = false;
  private optionsStorage!: LocalStorageAdapter;
  // 新增属性
  private gameState: GameState = 'idle';
  private currentOptions: GameOptions | null = null;
  private modelCards: ModelCard[] = [];
  private historyManager: any;
  private game: any;
  private kataGoEngine: any;
  private progressManager: HMPlayPageConfig['progressManager'];
  private eventBinder: HMEventBinder;
  private uiUpdater: HMUIUpdater;
  constructor(config: HMPlayPageConfig) {
    this.hmPlayApp = config.hmPlayApp;
    this.modelManager = config.modelManager;
    this.historyManager = config.historyManager;
    this.game = config.game;
    this.kataGoEngine = config.kataGoEngine;
    this.progressManager = config.progressManager;
    this.onNavigate = config.onNavigate;
    this.onShowOptionsDialog = config.onShowOptionsDialog;
    this.onUpdateButtons = config.onUpdateButtons;
    this.onUpdateTitleBar = config.onUpdateTitleBar;
    this.board = AdapterFactory.createBoard();
    this.dialog = AdapterFactory.createDialog();
    this.toast = AdapterFactory.createToast();
    this.progress = AdapterFactory.createProgress();
    this.audioPlayer = new WebAudioPlayer();
    
    // 初始化子模块
    this.uiUpdater = new HMUIUpdater();
    this.eventBinder = new HMEventBinder({
      page: this,
      onStartGame: (options) => this.startGameWithOptions(options),
    });
    this.optionsStorage = new LocalStorageAdapter('weiqi-hm-options');
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.board.initialize({ size: this.boardSize, showCoordinates: true });
    this.board.on({
      onClick: (pos: Position) => this.handleMove(pos),
    });
    await this.optionsStorage.initialize();
    // 加载模型
    await this.loadModel();
    // 设置回调
    this.hmPlayApp.setCallbacks(createHMPlayCallbacks(this.createCallbackContext()));
    this.initialized = true;
    // 添加全局点击事件监听器（用于取消选中状态）
    this.setupGlobalClickListener();
    // 检查草稿
    const draft = await this.hmPlayApp.loadDraft();
    if (draft && !draft.gameEnded && draft.moveHistory.length > 0) {
      this.showDraftRecoveryDialog(draft);
      this.uiState.setHasDraft(true);  // 标记有草稿
    } else {
      this.uiState.setHasDraft(false);  // 标记没有草稿
    }
  }
  /** 设置全局点击事件监听器 */
  private setupGlobalClickListener(): void {
    this.globalClickListener = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // 如果点击的是确认按钮或棋盘，不取消选中
      if (target.closest('#confirmBtn') || target.closest('#page-root')) {
        return;
      }
      // 点击其他地方（包括菜单按钮、下拉菜单、标题栏、状态栏等），取消选中状态
      if (this.uiState.getSelectedPosition()) {
        this.uiState.clearSelection();
        this.render();
      }
    };
    // 使用事件捕获阶段，这样可以在 e.stopPropagation() 之前捕获到点击事件
    document.addEventListener('click', this.globalClickListener, true);
  }
  /** 创建回调上下文 */
  private createCallbackContext() {
    const self = this;
    return {
      board: this.board,
      toast: this.toast,
      audioPlayer: this.audioPlayer,
      get playerColor() { return self.playerColor; },
      get moveCount() { return self.moveCount; },
      set moveCount(value) { self.moveCount = value; },
      updateStatus: (msg: string) => this.updateStatus(msg),
      updateMoveCount: (count: number) => { 
        this.moveCount = count;
        // 更新 HTML 中的手数显示
        const moveCountEl = document.getElementById('moveCount');
        if (moveCountEl) moveCountEl.textContent = String(count);
      },
      updateCaptures: (blackCaptures: number, whiteCaptures: number) => {
        // 更新 HTML 中的提子数量显示
        const blackCapturesEl = document.getElementById('blackCaptures');
        const whiteCapturesEl = document.getElementById('whiteCaptures');
        if (blackCapturesEl) blackCapturesEl.textContent = String(blackCaptures);
        if (whiteCapturesEl) whiteCapturesEl.textContent = String(whiteCaptures);
      },
      getCaptures: () => {
        // 获取当前提子数量
        const state = this.hmPlayApp.getState();
        return {
          blackCaptures: state.capturedBlack,
          whiteCaptures: state.capturedWhite,
        };
      },
      updateButtons: () => this.updateButtons(),
      handleGameEnd: (w: PlayerColor, r: string) => this.handleGameEnd(w, r),
      render: () => this.render(),
    };
  }
  handleParams(params: PageParams): void {
    if (params['visits']) this.visits = parseInt(params['visits']) || 100;
    if (params['color']) this.playerColor = params['color'] as PlayerColor;
    if (params['size']) this.boardSize = parseInt(params['size']) as BoardSize;
  }
  private async loadModel(): Promise<void> {
    try {
      this.progress.show();
      this.progress.setValue(10);
      this.progress.setConfig({ showLabel: true });
      this.progress.render();
      await this.hmPlayApp.loadModels();
      this.progress.setValue(100);
      this.progress.render();
      setTimeout(() => this.progress.hide(), 500);
    } catch (error) {
      this.toast.error('模型加载失败');
      this.progress.hide();
    }
  }
  async startGame(): Promise<void> {
    try {
      await this.hmPlayApp.newGame({
        playerColor: this.playerColor,
        difficulty: 'medium',
        visits: this.visits,
        handicap: 0,
        noUndo: false,
        modelId: 'default',
      });
      this.moveCount = 0;
      this.board.clear();
      this.board.render();
      this.render();
      this.toast.success('新对局开始');
    } catch (error) {
      this.toast.error('启动对局失败');
    }
  }
  private async handleMove(pos: Position): Promise<void> {
    if (!this.hmPlayApp.isPlayerTurn()) {
      this.toast.info('等待 AI 落子');
      return;
    }

    const state = this.hmPlayApp.getState();
    const stone = state.board[pos.y]?.[pos.x];

    // 点击已有棋子，清除选中
    if (stone) {
      this.uiState.clearSelection();
      this.render();
      return;
    }

    // 点击空位，检查是否是合法落子点
    // 通过 game.canPlaceStone 检查（包括禁入点和打劫规则）
    const canPlace = this.game.canPlaceStone(pos.x, pos.y);
    if (!canPlace) {
      // 不是合法落子点，不显示预览，保持当前状态
      this.toast.info('此处不能落子');
      return;
    }

    // 点击合法的空位
    const selectedPos = this.uiState.getSelectedPosition();
    if (selectedPos) {
      // 已经有选中位置，点击其他地方切换选中位置
      this.uiState.setSelectedPosition(pos);
      this.render();
      // 保持确认按钮显示
      this.uiState.hideToolbarButtons();
      this.uiState.showConfirmButton();
    } else {
      // 没有选中位置，显示预览
      this.uiState.setSelectedPosition(pos);
      this.render();
      this.uiState.hideToolbarButtons();
      this.uiState.showConfirmButton();
    }
  }
  async undo(): Promise<void> {
    const success = await this.hmPlayApp.undo();
    if (success) {
      this.moveCount = Math.max(0, this.moveCount - 2);
      this.toast.info('已悔棋');
      this.render();
      // 更新手数显示
      const moveCountEl = document.getElementById('moveCount');
      if (moveCountEl) moveCountEl.textContent = String(this.moveCount);
    }
  }
  async pass(): Promise<void> {
    await this.hmPlayApp.playerPass();
    this.toast.info('停一手');
    // 更新手数（停一手也算一手）
    this.moveCount++;
    const moveCountEl = document.getElementById('moveCount');
    if (moveCountEl) moveCountEl.textContent = String(this.moveCount);
  }
  async showSituation(): Promise<void> {
    try {
      // 显示加载提示
      this.updateStatus('正在分析形势...');
      const result = await this.hmPlayApp.analyze();
      await renderSituation(this.dialog, result);
      // 恢复状态栏
      if (this.hmPlayApp.isPlayerTurn()) {
        this.updateStatus('轮到你落子');
      } else {
        this.updateStatus('AI思考中...');
      }
    } catch (error) {
      this.toast.error('形势判断失败');
      // 恢复状态栏
      if (this.hmPlayApp.isPlayerTurn()) {
        this.updateStatus('轮到你落子');
      } else {
        this.updateStatus('AI思考中...');
      }
    }
  }
  async resign(): Promise<void> {
    const confirmed = await this.dialog.show({
      type: 'confirm',
      title: '确认认输',
      content: '确定要认输吗？',
    });
    if (confirmed) {
      await this.hmPlayApp.resign();
      this.toast.warning('您已认输');
    }
  }
  /** 设置玩家颜色 */
  setPlayerColor(color: PlayerColor): void {
    this.playerColor = color;
  }
  render(): void {
    this.renderBoard();
    renderPlayState(null as any, this.playerColor, this.moveCount);
    // 渲染预览棋子
    const selectedPos = this.uiState.getSelectedPosition();
    if (selectedPos) {
      const boardImpl = this.board as any;
      if (boardImpl.setPreviewStone) {
        boardImpl.setPreviewStone(selectedPos, this.playerColor);
      }
    }
  }
  /** 渲染棋盘 */
  private renderBoard(): void {
    const state = this.hmPlayApp.getState();
    this.board.clear();
    // 渲染棋子
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
  }
  /** 确认落子 */
  async confirmMove(): Promise<void> {
    const pos = this.uiState.getSelectedPosition();
    if (!pos) return;
    // 先清除选择状态，恢复功能栏
    this.uiState.clearSelection();
    this.render();
    // 立即更新手数（玩家落子）
    this.moveCount++;
    const moveCountEl = document.getElementById('moveCount');
    if (moveCountEl) moveCountEl.textContent = String(this.moveCount);
    // 播放玩家落子音效（会在提子时被 capture 音效覆盖）
    this.audioPlayer.play('stone').catch(() => {
      // 音效播放失败，静默处理
    });
    // 然后执行落子（会触发 AI 落子）
    const success = await this.hmPlayApp.playerMove(pos.x, pos.y);
    // AI 落子后，手数会在 onAiMove 回调中再次更新
    // 这里不需要再次更新
  }
  private showConfirmButton(): void {
    this.uiState.showConfirmButton();
  }
  private hideConfirmButton(): void {
    this.uiState.hideConfirmButton();
  }
  private hideToolbarButtons(): void {
    this.uiState.hideToolbarButtons();
  }
  private showToolbarButtons(): void {
    this.uiState.showToolbarButtons();
  }
  /** 更新状态栏 */
  private updateStatus(msg: string): void {
    updateStatus(msg);
  }
  /** 更新按钮状态 */
  private updateButtons(): void {
    const state = this.hmPlayApp.getState();
    const isPlayerTurn = this.hmPlayApp.isPlayerTurn();
    const gameEnded = state.gameEnded;
    const canUndo = this.hmPlayApp.canUndo();
    // 更新工具栏按钮
    updateButtons(isPlayerTurn, gameEnded, canUndo);
    // 通知 hm.ts 更新菜单按钮
    if (this.onUpdateButtons) {
      this.onUpdateButtons(isPlayerTurn, gameEnded, canUndo);
    }
  }
  /** 处理对局结束 */
  private async handleGameEnd(winner: PlayerColor, _reason: string): Promise<void> {
    this.updateButtons();
    showGameEndDialog(winner, this.playerColor);
    await this.hmPlayApp.saveToHistory();
  }
  /** 显示草稿恢复对话框 */
  private async showDraftRecoveryDialog(draft: any): Promise<void> {
    const container = document.getElementById('dialogContainer');
    if (!container) return;
    container.innerHTML = `
      <div class="dialog-overlay" style="display: flex;">
        <div class="dialog">
          <div class="dialog-title">恢复对局</div>
          <div style="text-align: center; margin-bottom: 20px; color: #666;">
            发现未完成的对局（手数: ${draft.moveCount ?? 0}），是否继续？
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
      await this.hmPlayApp.clearDraft();
      // 显示选项对话框
      if (this.onShowOptionsDialog) {
        this.onShowOptionsDialog();
      }
    });
  }
  /** 从草稿恢复 */
  private async restoreFromDraft(draft: any): Promise<void> {
    try {
      // 先切换模型（如果草稿中的 modelId 与当前模型不同）
      const modelId = draft.modelId ?? DefaultModelService.getDefaultModelId();
      const currentModelId = this.modelManager?.getCurrentModel();
      
      // 构造模型 URL：优先使用草稿中保存的 URL
      let modelUrl: string | undefined = draft.modelUrl;
      if (!modelUrl && modelId === 'custom') {
        // 自定义模型：从存储加载用户之前输入的 URL
        if (typeof this.modelManager?.loadCustomModelUrl === 'function') {
          modelUrl = (await this.modelManager.loadCustomModelUrl()) ?? undefined;
        }
        if (!modelUrl) {
          this.toast.error('自定义模型 URL 丢失，请开始新局');
          return;
        }
      }
      if (!modelUrl) {
        const { getWebRoot } = await import('../../../../../infrastructure/utils/web/pathUtils');
        const webRoot = getWebRoot();
        modelUrl = `${webRoot}models/${modelId}.bin.gz`;
      }
      
      if (this.modelManager && currentModelId !== modelId) {
        // 需要切换模型，显示进度
        this.progressManager.showLoading('正在加载模型...');
        
        // 使用 ModelManagementService 切换模型（先保存偏好，再加载）
        await this.modelManager.switchModel(modelId, modelUrl, (loaded: number, total: number, progress: number) => {
          this.progressManager.updateProgress(loaded, total, progress);
        }, (info: { stage: string; message: string; current?: number; total?: number }) => {
          // KataGo 初始化进度（tuning）
          this.progressManager.setInitProgress(info.message || '');
        });
        
        this.progressManager.hideLoading();
      }
      await this.hmPlayApp.restoreFromDraft(draft, modelUrl);
      this.moveCount = draft.moveCount ?? draft.moveHistory?.length ?? 0;
      this.playerColor = draft.playerColor ?? 'black';
      this.visits = draft.visits ?? 100;  // 恢复 visits 参数
      // 更新标题栏
      if (this.onUpdateTitleBar) {
        this.onUpdateTitleBar(this.playerColor);
      }
      this.render();
      // 更新手数显示
      const moveCountEl = document.getElementById('moveCount');
      if (moveCountEl) moveCountEl.textContent = String(this.moveCount);
      // 更新标题栏副标题
      const modelInfoEl = document.getElementById('modelInfo');
      if (modelInfoEl) {
        const colorText = this.playerColor === 'black' ? '执黑' : '执白';
        modelInfoEl.textContent = `${modelId} · ${this.visits} visits · ${colorText}`;
      }
      // 判断当前轮到谁落子
      if (this.hmPlayApp.isPlayerTurn()) {
        this.updateStatus('轮到你落子');
      } else {
        this.updateStatus('AI 思考中...');
      }
      // 更新按钮状态（启用菜单按钮）
      this.updateButtons();
      // 显示引擎信息
      this.showBackendInfo();
      this.toast.info('对局已恢复');
    } catch (error) {
      this.progressManager.hideLoading();
      this.toast.error('恢复对局失败');
    }
  }
  /** 检查是否有未完成的对局草稿 */
  hasDraftToRecover(): boolean {
    return this.uiState.hasDraftToRecover();
  }

  /** 获取当前游戏选项 */
  getCurrentOptions(): GameOptions | null {
    return this.currentOptions;
  }

  /** 设置模型卡片列表 */
  setModelCards(cards: ModelCard[]): void {
    this.modelCards = cards;
  }

  /** 绑定所有 UI 事件 */
  bindAllEvents(): void {
    this.eventBinder.bindAll();
  }

  /** 显示选项对话框 */
  async showOptionsDialog(): Promise<void> {
    const dialog = document.getElementById('optionsDialog');
    if (dialog) {
      // 读取保存的选项
      const savedOptions = await this.optionsStorage.read<GameOptions>('options');
      
      // 设置计算量滑块
      if (savedOptions?.visits) {
        const visitsSlider = document.getElementById('visitsSlider') as HTMLInputElement;
        const visitsValue = document.getElementById('visitsValue');
        if (visitsSlider) {
          visitsSlider.value = String(savedOptions.visits);
          if (visitsValue) visitsValue.textContent = String(savedOptions.visits);
        }
      }
      
      // 设置执色选择
      if (savedOptions?.playerColor) {
        const colorRow = document.getElementById('colorRow');
        colorRow?.querySelectorAll('.option-btn').forEach(btn => {
          btn.classList.toggle('active', btn.getAttribute('data-value') === savedOptions.playerColor);
        });
      }
      
      // 设置让子选择
      if (savedOptions?.handicap !== undefined) {
        const handicapRow = document.getElementById('handicapRow');
        handicapRow?.querySelectorAll('.option-btn').forEach(btn => {
          btn.classList.toggle('active', btn.getAttribute('data-value') === String(savedOptions.handicap));
        });
      }
      
      // 设置规则选择
      if (savedOptions?.noUndo !== undefined) {
        const rulesRow = document.getElementById('rulesRow');
        rulesRow?.querySelectorAll('.option-btn').forEach(btn => {
          const isNoUndo = btn.getAttribute('data-value') === 'no-undo';
          btn.classList.toggle('active', (savedOptions.noUndo && isNoUndo) || (!savedOptions.noUndo && !isNoUndo));
        });
      }
      
      // 使用 ModelSelector 组件渲染模型选择
      const modelCardsContainer = document.getElementById('modelCards');
      if (modelCardsContainer && this.modelManager) {
        // 创建 ModelSelector 实例
        const currentModelId = this.modelManager.getCurrentModel();
        const modelSelector = new ModelSelector({
          currentModelId,
          modelManager: this.modelManager,
        });
        
        // 加载模型列表
        await modelSelector.loadModels();
        
        // 渲染模型选择 UI
        modelCardsContainer.innerHTML = modelSelector.render();
        
        // 绑定事件
        modelSelector.bindEvents(modelCardsContainer);
        
        // 保存 modelSelector 实例，以便在点击"开始对局"时获取选中的模型
        (this as any).modelSelector = modelSelector;
      }
      
      dialog.style.display = 'flex';
    }
    this.updateStatus('等待开始...');
  }

  /** 隐藏选项对话框 */
  hideOptionsDialog(): void {
    const dialog = document.getElementById('optionsDialog');
    if (dialog) {
      dialog.style.display = 'none';
    }
  }

  /** 带选项的开始游戏 */
  async startGameWithOptions(options: GameOptions): Promise<void> {
    try {
      this.currentOptions = options;
      this.setGameState('loading');
      this.hideOptionsDialog();
      
      // 保存选项
      await this.optionsStorage.write('options', {
        visits: options.visits,
        playerColor: options.playerColor,
        handicap: options.handicap,
        noUndo: options.noUndo,
      });
      
      // 显示加载
      this.progressManager.showLoading('正在初始化 AI...');
      
      // 给浏览器一点时间更新 UI，避免阻塞
      await new Promise(resolve => setTimeout(resolve, 0));

      // 使用 ModelManagementService 切换模型（如果可用）
      if (this.modelManager) {
        // 获取模型 URL
        let modelUrl: string | undefined;
        if (options.modelId === 'custom') {
          // 自定义模型：从 modelSelector 获取 URL 或从存储加载
          const modelSelector = (this as any).modelSelector;
          modelUrl = modelSelector?.getCustomModelUrl?.();
          
          // 如果没有从 modelSelector 获取到 URL，从存储加载
          if (!modelUrl && typeof this.modelManager.loadCustomModelUrl === 'function') {
            modelUrl = await this.modelManager.loadCustomModelUrl();
          }
        } else {
          // 内置模型：构造本地路径
          const { getWebRoot } = await import('../../../../../infrastructure/utils/web/pathUtils');
          const webRoot = getWebRoot();
          modelUrl = `${webRoot}models/${options.modelId}.bin.gz`;
        }
        
        await this.modelManager.switchModel(options.modelId, modelUrl, (loaded: number, total: number, progress: number) => {
          this.progressManager.updateProgress(loaded, total, progress);
        }, (info: { stage: string; message: string; current?: number; total?: number }) => {
          // KataGo 初始化进度（tuning）
          this.progressManager.setInitProgress(info.message || '');
        });
      }

      await this.hmPlayApp.newGame({
        playerColor: options.playerColor,
        difficulty: 'medium',  // 固定中等难度
        visits: options.visits,  // 用户选择的计算量
        handicap: options.handicap,
        noUndo: options.noUndo,
        modelId: options.modelId,
        modelUrl: '',  // 已经通过 modelManager 切换，不需要再传递
        onProgress: (loaded: number, total: number, progress: number) => {
          this.progressManager.updateProgress(loaded, total, progress);
        },
      });

      // 更新页面的玩家颜色(用于预览棋子颜色)
      this.playerColor = options.playerColor;
      this.visits = options.visits;

      this.progressManager.hideLoading();
      this.setGameState('running');

      // 更新标题栏模型信息
      if (this.onUpdateTitleBar) {
        this.onUpdateTitleBar(options.playerColor);
      }
      this.updateModelInfo(options);
      
      // 显示引擎信息
      this.showBackendInfo();

      this.render();
    } catch (error) {
      this.progressManager.hideLoading();
      this.setGameState('idle');
      // 启动对局失败
      this.toast.error('启动对局失败');
      this.showOptionsDialog();
    }
  }

  /** 设置游戏状态 */
  setGameState(state: GameState): void {
    this.gameState = state;
    this.uiUpdater.setCurrentOptions(this.currentOptions);
    this.uiUpdater.setGameState(state);
  }

  /** 更新标题栏 */
  updateTitleBar(playerColor: PlayerColor): void {
    this.uiUpdater.updateTitleBar(playerColor);
  }

  /** 更新标题栏模型信息 */
  private updateModelInfo(options: GameOptions): void {
    this.uiUpdater.setModelCards(this.modelCards);
    this.uiUpdater.updateModelInfo(options);
  }

  /** 显示后端引擎信息 */
  showBackendInfo(): void {
    this.uiUpdater.setKataGoEngine(this.kataGoEngine);
    this.uiUpdater.showBackendInfo();
  }
  destroy(): void {
    // 移除全局点击监听器
    if (this.globalClickListener) {
      document.removeEventListener('click', this.globalClickListener, true);
      this.globalClickListener = undefined;
    }
    this.board.destroy();
    this.dialog.destroy();
    this.toast.destroy();
    this.progress.destroy();
    this.initialized = false;
  }
}
