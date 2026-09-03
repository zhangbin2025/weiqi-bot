/**
 * 棋谱查看器页面
 * @module presentation/pages/replay/ReplayPage
 * @description 重构后的协调者模式 - 各功能模块化拆解
 */
import { MoveNavigator, VariationController, TrialController, CapturedController } from '../../../../core/controllers';
import { WebBoard } from '../../components/Board';
import { Game } from '../../../../../domain/game';
import { coordToPos, posToCoord } from '../../../../../domain/sgf';
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
          game_name: replayData.game_name,
          max_moves: replayData.max_moves,
          handicap_stones: replayData.handicap_stones
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
  /**
   * 获取当前 SGF 内容（完整）
   */
  getSgfContent(): string | null {
    return this.state.get('sgfContent');
  }

  /**
   * 生成精简 SGF（供二维码用）
   * 只包含棋盘大小 + initial stones + 到当前move的着法序列
   */
  getCompactSgf(): string | null {
    const replayData = this.state.get('replayData');
    if (!replayData) return null;

    let sgf = "(;SZ[" + replayData.board_size + "]";

    // initial stones (AB/AW)
    const handicapStones = replayData.handicap_stones;
    if (handicapStones && handicapStones.length > 0) {
      const blackStones = handicapStones.filter(s => s.color === 'B');
      const whiteStones = handicapStones.filter(s => s.color === 'W');
      if (blackStones.length > 0) {
        sgf += "AB" + blackStones.map(s => "[" + posToCoord(s.x, s.y) + "]").join("");
      }
      if (whiteStones.length > 0) {
        sgf += "AW" + whiteStones.map(s => "[" + posToCoord(s.x, s.y) + "]").join("");
      }
    }

    // 沿 currentPath + displayIndex 收集着法
    const path = this.state.get('currentPath');
    const displayIndex = this.state.get('displayIndex');
    let node = replayData.tree;
    const moves: string[] = [];

    for (const index of path) {
      if (!node.children || node.children.length <= index) break;
      node = node.children[index]!;
      if (node.color && node.coord) {
        moves.push((node.color === 'B' ? ';B[' : ';W[') + node.coord + ']');
      }
    }
    for (let i = 0; i < displayIndex && node.children && node.children.length > 0; i++) {
      node = node.children[0]!;
      if (node.color && node.coord) {
        moves.push((node.color === 'B' ? ';B[' : ';W[') + node.coord + ']');
      }
    }

    sgf += moves.join('');
    sgf += ')';

    return sgf;
  }

  /**
   * 获取当前局面数据（供打印使用）
   */
  getPrintData(): { stones: Array<{ x: number; y: number; color: 'black' | 'white' }>; lastMove: { x: number; y: number; color: 'black' | 'white' } | undefined; blackName: string; whiteName: string; moveNumber: number; turn: 'black' | 'white'; size: number; viewBox?: { minX: number; minY: number; width: number; height: number } | undefined } {
    // 优先从 WebBoard 获取（显示层当前状态，包含 handicap stones）
    const boardStones = this.board.getStones();
    let stones: Array<{ x: number; y: number; color: 'black' | 'white' }>;
    if (boardStones.size > 0) {
      stones = [];
      for (const [key, color] of boardStones) {
        const [x, y] = key.split(',').map(Number);
        stones.push({ x: x!, y: y!, color });
      }
    } else {
      // fallback: 从 game 获取
      stones = this.game.getBoard().getAllStones().map(s => ({
        x: s.x,
        y: s.y,
        color: s.color,
      }));
    }

    const replayData = this.state.get('replayData');
    const blackName = replayData?.black || '黑棋';
    const whiteName = replayData?.white || '白棋';
    const boardSize = replayData?.board_size || 19;
    const moveNumber = this.state.getCurrentMoveNumber();

    // 获取最后一手
    const currentNode = this.state.getCurrentNode();
    let lastMove: { x: number; y: number; color: 'black' | 'white' } | undefined;
    if (currentNode?.color && currentNode?.coord) {
      const pos = coordToPos(currentNode.coord);
      if (pos) {
        lastMove = {
          x: pos.x,
          y: pos.y,
          color: currentNode.color === 'B' ? 'black' : 'white',
        };
      }
    }

    // 当前该谁下，直接从 game 状态获取
    const turn = this.game.getState().currentPlayer;

    // 计算棋子边界框（仅用于死活题局部打印）
    // 死活题判断：move=0（初始局面）且 SGF 有 initial stones（AB/AW）
    // 定式、对局等其它场景保留整个棋盘
    let viewBox: { minX: number; minY: number; width: number; height: number } | undefined;
    const isTsumego = moveNumber === 0 && !!(replayData?.handicap_stones && replayData.handicap_stones.length > 0);
    if (isTsumego && boardSize >= 13 && stones.length > 0) {
      let minX = 19, maxX = 0, minY = 19, maxY = 0;
      for (const s of stones) {
        minX = Math.min(minX, s.x);
        maxX = Math.max(maxX, s.x);
        minY = Math.min(minY, s.y);
        maxY = Math.max(maxY, s.y);
      }
      // 上下左右各留 1-2 行余量
      const margin = 2;
      minX = Math.max(0, minX - margin);
      minY = Math.max(0, minY - margin);
      maxX = Math.min(boardSize - 1, maxX + margin);
      maxY = Math.min(boardSize - 1, maxY + margin);
      // 只有当局部区域明显小于全盘时才裁剪
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      if (w < boardSize - 2 && h < boardSize - 2) {
        viewBox = { minX, minY, width: w, height: h };
      }
    }

    return { stones, lastMove, blackName, whiteName, moveNumber, turn, size: boardSize, viewBox };
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
