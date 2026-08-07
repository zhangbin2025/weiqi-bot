/**
 * 棋谱查看器页面
 * @module presentation/pages/replay/ReplayPage
 * @description 重构后的协调者模式 - 各功能模块化拆解
 */
import { MoveNavigator, VariationController, TrialController, CapturedController } from '../../../../core/controllers';
import { WebBoard } from '../../components/Board';
import { Game } from '../../../../../domain/game';
import { BoardRebuilder } from '../../../../core/helpers/BoardRebuilder';
import { BoardSyncer } from '../../../../core/helpers/BoardSyncer';
import { ReplayPageState } from './state';
import { ReplayDataManager } from './data';
import { ReplayPageUI } from './ui';
import { NavigationHandler, VariationHandler, TrialHandler } from './handlers';
import type { IPage, PageParams } from '../../../../core/interfaces';
import type { ReplayData } from '../../../../../domain/sgf';
import type { ReplayApp } from '../../../../../application/replay';
export class ReplayPage implements IPage {
  readonly title = '棋谱查看';
  // 核心组件
  private board: WebBoard;
  private game: Game;
  private replayApp: ReplayApp;
  private onNavigate?: ((page: string, params?: Record<string, string>) => void) | undefined;
  // 控制器
  private moveNavigator: MoveNavigator;
  private variationController: VariationController;
  private trialController: TrialController;
  private capturedController: CapturedController;
  // 模块化组件
  private state: ReplayPageState;
  private dataManager: ReplayDataManager;
  private ui: ReplayPageUI;
  private navigationHandler: NavigationHandler;
  private variationHandler: VariationHandler;
  private trialHandler: TrialHandler;
  constructor(config: { replayApp: ReplayApp; onNavigate?: (page: string, params?: Record<string, string>) => void }) {
    this.replayApp = config.replayApp;
    this.onNavigate = config.onNavigate;
    // 初始化组件
    this.board = new WebBoard();
    this.game = new Game();
    // 初始化状态管理
    this.state = new ReplayPageState();
    // 初始化控制器
    this.moveNavigator = new MoveNavigator({ 
      maxMoves: 0, 
      onMoveChange: (i) => { 
        this.state.set('displayIndex', i);
        this.navigationHandler.updateDisplay();
        this.ui.updateSlider(i);
        // 更新变化图面板
        this.ui.updateVariationPanel((index) => this.variationHandler.enterVariation(index));
        // 自动播放时播放音效
        if (this.moveNavigator.getIsPlaying() && this.state.get('soundEnabled')) {
          this.replayApp.playSound('stone');
        }
      },
      onPlayStateChange: (isPlaying) => {
        this.ui.updatePlayButton(isPlaying);
      }
    });
    this.variationController = new VariationController({ 
      onSelect: (i) => this.variationHandler.enterVariation(i), 
      onBackToParent: () => this.variationHandler.backToParent() 
    });
    this.trialController = new TrialController({ 
      onEnter: () => {
        this.ui.showTrialPanel(true);
      },
      onExit: () => {
        this.ui.showTrialPanel(false);
      }
    });
    this.capturedController = new CapturedController({
      onChange: (black, white) => this.ui.updateCapturedDisplay(black, white)
    });
    // 初始化模块
    this.dataManager = new ReplayDataManager(
      this.state,
      this.replayApp,
      this.board,
      this.moveNavigator
    );
    this.ui = new ReplayPageUI(
      this.state,
      this.board,
      this.variationController,
      (result) => this.dataManager.translateResult(result)
    );
    this.navigationHandler = new NavigationHandler(
      this.state,
      this.ui,
      this.moveNavigator,
      this.replayApp,
      this.game,
      this.board,
      BoardRebuilder,
      BoardSyncer
    );
    this.variationHandler = new VariationHandler(
      this.state,
      this.ui,
      this.variationController,
      this.replayApp,
      this.game,
      this.board,
      BoardRebuilder,
      BoardSyncer
    );
    // 设置进入分支的回调
    this.variationHandler.setOnEnterVariation((index) => this.variationHandler.enterVariation(index));
    this.trialHandler = new TrialHandler(
      this.state,
      this.ui,
      this.trialController,
      this.replayApp,
      this.game,
      this.board,
      BoardRebuilder,
      BoardSyncer
    );
  }
  async initialize(): Promise<void> {
    if (this.state.get('initialized')) return;
    // 初始化棋盘
    const replayData = this.state.get('replayData');
    const size = (replayData?.board_size || 19) as 9 | 13 | 19;
    this.board.initialize({ size, showCoordinates: true, showMoveNumbers: false });
    // 绑定 DOM 事件
    this.ui.bindEvents({
      onSliderChange: (value) => this.navigationHandler.goToMove(value),
      onPrevMove: () => this.navigationHandler.prevMove(),
      onNextMove: () => this.navigationHandler.nextMove(),
      onTogglePlay: () => this.navigationHandler.togglePlay(),
      onBackToParent: () => this.variationHandler.backToParent(),
      onToggleSound: () => this.toggleSound(),
      onToggleMoveNumbers: () => this.toggleMoveNumbers(),
      onDownloadSGF: () => this.downloadSGF(),
      onTrialPrev: () => this.trialHandler.trialPrev(),
      onExitTrial: () => this.trialHandler.exitTrial(),
      onTrialNext: () => this.trialHandler.trialNext(),
    });
    // 监听来自HTML的事件
    window.addEventListener('toggleSound', () => {
      this.toggleSound();
    });
    window.addEventListener('toggleMoveNumbers', () => {
      this.toggleMoveNumbers();
    });
    window.addEventListener('togglePlay', () => {
      this.navigationHandler.togglePlay();
    });
    window.addEventListener('downloadSGF', () => {
      this.downloadSGF();
    });
    // 绑定棋盘点击事件（试下模式）
    this.board.on({
      onClick: (pos) => this.trialHandler.handleBoardClick(pos.x, pos.y)
    });
    this.state.set('initialized', true);
  }
  /**
   * 从 URL 参数加载
   */
  handleParams(params: PageParams): void {
    this.dataManager.handleParams(params as Record<string, string>);
    this.render();
  }
  /**
   * 从 SGF 内容加载
   */
  loadFromSGF(sgf: string, options?: { defaultMove?: number }): void {
    this.dataManager.loadFromSGF(sgf, options);
    // 加载数据后立即更新 UI（包括滑块的最大值）
    this.ui.updateGameInfo();
    // 触发事件通知HTML更新游戏信息
    const replayData = this.state.get('replayData');
    if (replayData) {
      const resultText = replayData.result ? this.dataManager.translateResult(replayData.result) : '';
      window.dispatchEvent(new CustomEvent('gameInfoUpdated', {
        detail: {
          black: replayData.black,
          white: replayData.white,
          result: resultText,
          game_name: replayData.game_name
        }
      }));
    }
  }
  /**
   * 设置数据
   */
  setData(data: ReplayData): void {
    this.dataManager.setData(data);
    // 设置数据后立即更新 UI
    this.ui.updateGameInfo();
  }
  /**
   * 切换音效
   */
  private toggleSound(): void {
    const soundEnabled = !this.state.get('soundEnabled');
    this.state.set('soundEnabled', soundEnabled);
    this.ui.updateSoundButton(soundEnabled);
    // 如果开启音效，尝试预解锁 AudioContext
    if (soundEnabled) {
      this.replayApp.initializeAudio();
    }
  }
  /**
   * 切换手数显示
   */
  private toggleMoveNumbers(): void {
    const showMoveNumbers = !this.state.get('showMoveNumbers');
    this.state.set('showMoveNumbers', showMoveNumbers);
    this.ui.updateMoveNumbersButton(showMoveNumbers);
    // 更新 board 配置
    this.board['config'].showMoveNumbers = showMoveNumbers;
    this.navigationHandler.updateDisplay();
  }
  /**
   * 下载 SGF
   */
  private async downloadSGF(): Promise<void> {
    const sgfContent = this.state.get('sgfContent');
    if (!sgfContent) {
      return;
    }
    const replayData = this.state.get('replayData');
    const gameName = replayData?.game_name || 'game';
    await this.replayApp.downloadSGF(sgfContent, gameName);
  }
  render(): void {
    this.board.render();
    this.ui.updateGameInfo();
    // 初始更新分支面板
    this.ui.updateVariationPanel((index) => this.variationHandler.enterVariation(index));
  }
  destroy(): void {
    this.moveNavigator.destroy();
    this.trialController.reset();
    this.capturedController.reset();
    this.board.destroy();
    this.state.reset();
  }
}
