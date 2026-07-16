/**
 * 真人对弈页面控制器
 * @module presentation/pages/play/HHPlayPage
 */
import { WebBoard } from '../../components/Board';
import { AdapterFactory } from '../../../../adapters';
import { WebAudioPlayer } from '../../../../../infrastructure/audio/WebAudioPlayer';
import type { IPage, PageParams, IToast, IDialog } from '../../../../core/interfaces';
import type { HHPlayApp } from '../../../../../application/play';
import type { PlayerColor, Position } from '../../../../core/types';
import type { HHPlayDraft } from '../../../../../services/play/hh/DraftTypes';
import { HHDialogRenderer } from './HHDialogRenderer';
import { renderHHState, renderStatus, updateButtons, type HHRenderState } from './HHPlayRenderer';
import { HHRoomController, generateRandomName, getPlayerNameCache, setPlayerNameCache } from './controllers/HHRoomController';
import { HHGameController } from './controllers/HHGameController';
import { HHOpponentHandler } from './controllers/HHOpponentHandler';
import { HHDraftController } from './controllers/HHDraftController';
import { HHCallbacksHandler } from './callbacks/HHCallbacksHandler';
import { HHToolbarManager } from './renderers/HHToolbarManager';
import { HHBoardRenderer } from './renderers/HHBoardRenderer';
import { getWebRoot } from '../../../../../infrastructure/utils/web/pathUtils';
export interface HHPlayPageConfig {
  hhPlayApp: HHPlayApp;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
}
/**
 * 真人对弈页面
 * @description 组合各个子模块，协调页面逻辑
 */
export class HHPlayPage implements IPage {
  readonly title = '真人对弈';
  private hhPlayApp: HHPlayApp;
  private onNavigate?: ((page: string, params?: Record<string, string>) => void) | undefined;
  private board: WebBoard;
  private toast: IToast;
  private dialog: IDialog;
  private dialogRenderer: HHDialogRenderer;
  private audioPlayer: WebAudioPlayer;
  // 子模块
  private roomController: HHRoomController;
  private gameController: HHGameController;
  private opponentHandler: HHOpponentHandler;
  private draftController: HHDraftController;
  private callbacksHandler: HHCallbacksHandler;
  private toolbarManager: HHToolbarManager;
  private boardRenderer: HHBoardRenderer;
  // 状态
  private roomId: string | undefined;
  private myColor: PlayerColor | undefined;
  private myName: string;
  private opponentName: string = '';
  private blackTime: number = 1800;
  private whiteTime: number = 1800;
  private timeLimit: number = 30;
  private handicap: number = 0;
  private initialized = false;
  private selectedPosition: Position | null = null;
  constructor(config: HHPlayPageConfig) {
    this.hhPlayApp = config.hhPlayApp;
    this.onNavigate = config.onNavigate;
    this.board = new WebBoard();
    this.toast = AdapterFactory.createToast();
    this.dialog = AdapterFactory.createDialog();
    this.dialogRenderer = new HHDialogRenderer();
    this.audioPlayer = new WebAudioPlayer();
    this.myName = getPlayerNameCache() || generateRandomName();
    // 初始化子模块
    this.roomController = new HHRoomController({
      hhPlayApp: this.hhPlayApp,
      toast: this.toast,
    });
    this.gameController = new HHGameController({
      hhPlayApp: this.hhPlayApp,
      board: this.board,
      toast: this.toast,
      dialog: this.dialog,
      myColor: this.myColor,
    });
    this.opponentHandler = new HHOpponentHandler({
      hhPlayApp: this.hhPlayApp,
      dialogRenderer: this.dialogRenderer,
      myColor: this.myColor,
    });
    this.draftController = new HHDraftController({
      hhPlayApp: this.hhPlayApp,
      dialogRenderer: this.dialogRenderer,
      toast: this.toast,
    });
    this.callbacksHandler = new HHCallbacksHandler({
      hhPlayApp: this.hhPlayApp,
    });
    this.toolbarManager = new HHToolbarManager();
    this.boardRenderer = new HHBoardRenderer({ board: this.board });
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.board.initialize({ size: 19, showCoordinates: true });
    this.board.on({
      onClick: (pos: Position) => this.handleMove(pos),
    });
    this.setupCallbacks();
    this.initialized = true;
    // 检查草稿
    const draft = await this.draftController.loadDraft();
    if (draft && draft.inGame && !draft.gameEnded && !draft.abandoned) {
      this.draftController.showDraftRecoveryDialog(
        draft,
        (state) => this.handleReconnect(state),
        () => this.renderStartDialog()
      );
    } else {
      this.renderStartDialog();
    }
  }
  handleParams(params: PageParams): void {
    if (params['roomId']) {
      this.handleJoinRoom(params['roomId']);
    }
  }
  // ========== 对话框渲染 ==========
  private renderStartDialog(): void {
    this.dialogRenderer.showStartDialog(
      () => this.showCreateDialog(),
      () => this.showJoinDialog()
    );
  }
  private showCreateDialog(): void {
    const name = this.myName || generateRandomName();
    this.dialogRenderer.showCreateDialog(
      name,
      (name, color, handicap, timeLimit) => this.handleCreateRoom(name, color, handicap, timeLimit),
      () => this.renderStartDialog()
    );
  }
  private showJoinDialog(): void {
    const name = this.myName || generateRandomName();
    this.dialogRenderer.showJoinDialog(
      name,
      (roomId, name) => this.handleJoinRoom(roomId, name),
      () => this.renderStartDialog()
    );
  }
  private showWaitingDialog(): void {
    this.dialogRenderer.showWaitingDialog(
      this.roomId || '',
      this.myColor || 'black',
      this.handicap,
      this.timeLimit,
      () => this.handleLeaveRoom()
    );
  }
  private closeDialog(): void {
    this.dialogRenderer.close();
  }
  // ========== 房间操作 ==========
  private async handleCreateRoom(name: string, color: 'black' | 'white' | 'random', handicap: number, timeLimit: number): Promise<void> {
    this.myName = name;
    setPlayerNameCache(name);
    this.showLoadingOverlay('创建房间中...');
    try {
      const roomInfo = await this.roomController.createRoom({ name, color, handicap, timeLimit });
      this.roomId = roomInfo.roomId;
      this.myColor = roomInfo.creatorColor;
      this.timeLimit = timeLimit;
      this.handicap = handicap;
      this.blackTime = timeLimit * 60;
      this.whiteTime = timeLimit * 60;
      this.gameController.setMyColor(this.myColor);
      this.opponentHandler.setMyColor(this.myColor);
      this.hideLoadingOverlay();
      this.showWaitingDialog();
    } catch (error) {
      this.hideLoadingOverlay();
      // 错误已在 roomController 中处理
    }
  }
  private async handleJoinRoom(roomId?: string, name?: string): Promise<void> {
    const roomIdInput = document.getElementById('joinRoomId') as HTMLInputElement;
    const nameInput = document.getElementById('joinName') as HTMLInputElement;
    const id = roomId || roomIdInput?.value.trim().toUpperCase();
    const playerName = name || nameInput?.value.trim() || generateRandomName();
    this.showLoadingOverlay('加入房间中...');
    try {
      const result = await this.roomController.joinRoom(id || '', playerName);
      this.myName = playerName;
      this.hideLoadingOverlay();
      if (result.roomInfo) {
        this.showJoinConfirmDialog(result.roomInfo, id || '');
      } else {
        this.toast.error('无法获取房间信息');
      }
    } catch (error) {
      this.hideLoadingOverlay();
      // 错误已在 roomController 中处理
    }
  }
  private showJoinConfirmDialog(roomInfo: {
    creatorName: string;
    creatorColor: 'black' | 'white';
    handicap: number;
    timeLimit: number;
  }, roomId: string): void {
    this.dialogRenderer.showJoinConfirmDialog(
      roomInfo,
      getPlayerNameCache() || generateRandomName(),
      (name) => this.handleConfirmJoin(roomInfo, roomId, name),
      () => this.renderStartDialog()
    );
  }
  private async handleConfirmJoin(roomInfo: {
    creatorName: string;
    creatorColor: 'black' | 'white';
    handicap: number;
    timeLimit: number;
  }, roomId: string, name: string): Promise<void> {
    try {
      const result = await this.roomController.confirmJoin(name);
      this.roomId = roomId;
      this.myColor = result.color;
      this.opponentName = roomInfo.creatorName;
      this.timeLimit = roomInfo.timeLimit;
      this.blackTime = roomInfo.timeLimit * 60;
      this.whiteTime = roomInfo.timeLimit * 60;
      this.gameController.setMyColor(this.myColor);
      this.opponentHandler.setMyColor(this.myColor);
      this.closeDialog();
      this.render();
    } catch (error) {
      // 错误已在 roomController 中处理
    }
  }
  private async handleLeaveRoom(): Promise<void> {
    await this.roomController.leaveRoom();
    this.roomId = undefined;
    this.myColor = undefined;
    this.opponentName = '';
    this.renderStartDialog();
  }
  // ========== 游戏操作 ==========
  private async handleMove(pos: Position): Promise<void> {
    const shouldSelect = await this.gameController.handleClick(pos);
    if (shouldSelect) {
      this.selectedPosition = pos;
      this.renderBoard();
      this.toolbarManager.hideToolbarButtons();
      this.toolbarManager.showConfirmButton();
    } else {
      this.selectedPosition = null;
      this.renderBoard();
      this.toolbarManager.hideConfirmButton();
      this.toolbarManager.showToolbarButtons();
    }
  }
  async confirmMove(): Promise<void> {
    if (!this.selectedPosition) return;
    try {
      await this.gameController.confirmMove(this.selectedPosition);
      this.selectedPosition = null;
      this.toolbarManager.hideConfirmButton();
      this.toolbarManager.showToolbarButtons();
    } catch (error) {
      // 错误已在 gameController 中处理
    }
  }
  async requestUndo(): Promise<void> {
    await this.gameController.requestUndo();
    this.updateStatus('已请求悔棋');
  }
  async pass(): Promise<void> {
    await this.gameController.pass();
    this.updateStatus('停一手');
  }
  async requestCount(): Promise<void> {
    const confirmed = await this.gameController.requestCount();
    if (confirmed) {
      this.updateStatus('已发送数子请求');
    }
  }
  async resign(): Promise<void> {
    await this.gameController.resign();
  }
  // ========== 草稿恢复 ==========
  private async handleReconnect(state: {
    roomId: string;
    myName: string;
    myColor: 'black' | 'white';
    opponentName: string;
    timeLimit: number;
    blackTime: number;
    whiteTime: number;
  }): Promise<void> {
    this.roomId = state.roomId;
    this.myName = state.myName;
    this.myColor = state.myColor;
    this.opponentName = state.opponentName;
    this.timeLimit = state.timeLimit;
    this.blackTime = state.blackTime;
    this.whiteTime = state.whiteTime;
    this.gameController.setMyColor(this.myColor);
    this.opponentHandler.setMyColor(this.myColor);
    this.renderBoard();
    this.renderPlayers();
    this.updateStatus('棋局已恢复，正在重新连接...');
  }
  // ========== 回调设置 ==========
  private setupCallbacks(): void {
    this.hhPlayApp.setCallbacks({
      onRoomCreated: (room) => {
        this.roomId = room.id;
        this.myColor = room.creatorColor;
        this.timeLimit = room.timeLimit;
        this.blackTime = room.timeLimit * 60;
        this.whiteTime = room.timeLimit * 60;
        this.showWaitingDialog();
      },
      onPlayerJoined: (player) => {
        this.opponentName = player.name;
        this.closeDialog();
        // 清除等待重连的定时器
        this.opponentHandler.handleReconnected();
        this.render();
        this.updateStatus('对手已加入');
      },
      onMove: (x, y, color) => {
        console.debug(`${color} 方落子 (${x}, ${y})`);
        // 播放落子音效
        this.audioPlayer.play('stone').catch(() => {
          console.warn('落子音效播放失败');
        });
        const state = this.hhPlayApp.getState();
        if (state.currentPlayer !== this.myColor) {
          if (this.selectedPosition) {
            this.selectedPosition = null;
            this.toolbarManager.hideConfirmButton();
            this.toolbarManager.showToolbarButtons();
          }
        }
        this.renderBoard();
        this.render();
      },
      onPass: (color) => {
        this.updateStatus(`${color === 'black' ? '黑方' : '白方'}停一手`);
        const state = this.hhPlayApp.getState();
        if (state.currentPlayer !== this.myColor) {
          if (this.selectedPosition) {
            this.selectedPosition = null;
            this.toolbarManager.hideConfirmButton();
            this.toolbarManager.showToolbarButtons();
          }
        }
        // 停一手后也要更新整个界面（包括菜单项的禁用状态）
        this.render();
      },
      onCapture: (count, color) => {
        // 播放提子音效
        this.audioPlayer.play('capture').catch(() => {
          console.warn('提子音效播放失败');
        });
        const colorText = color === 'black' ? '黑方' : '白方';
        this.toast.info(`${colorText}提子 ${count} 枚`);
      },
      onTimeUpdate: (blackTime, whiteTime) => {
        this.blackTime = blackTime;
        this.whiteTime = whiteTime;
        this.renderPlayers();
      },
      onGameEnd: (winner, reason, scoreLead) => {
        this.hideCountingOverlay();
        this.callbacksHandler.handleGameEnd(winner, reason, scoreLead, () => {
          window.location.href = getWebRoot() + 'index.html';
        });
      },
      onOpponentDisconnected: () => {
        this.handleOpponentDisconnected();
      },
      onOpponentReconnected: () => {
        this.opponentHandler.handleReconnected();
        this.updateStatus('对手已恢复');
      },
      onError: (error) => {
        // 隐藏数子加载层
        this.hideCountingOverlay();
        this.toast.error(error.message);
        this.updateStatus('错误: ' + error.message);
      },
      onCountRequest: (from) => {
        this.showCountRequestDialog(from);
      },
      onUndoRequest: (from) => {
        this.showUndoRequestDialog(from);
      },
      onUndoRejected: () => {
        this.updateStatus('对手拒绝了悔棋请求');
        this.toast.warning('对手拒绝了悔棋请求');
      },
      onCountResponse: (agree) => {
        if (agree) {
          this.showCountingOverlay();
          this.updateStatus('对手同意数子，开始分析...');
          // 数子会在 HHPlayService 中自动进行
        } else {
          this.updateStatus('对手拒绝数子');
        }
      },
      onCountResult: (scoreLead, winner) => {
        this.callbacksHandler.handleGameEnd(winner, 'count', scoreLead, () => {
          window.location.href = getWebRoot() + 'index.html';
        });
      },
      onHeartbeatReceived: () => {
        // 收到心跳，兜底检查并纠正状态
        // 如果在等待重连状态，说明对手已经重连了
        this.opponentHandler.handleReconnected();
      },
    });
  }
  private handleOpponentDisconnected(): void {
    this.updateStatus('对手连接中断，等待恢复...');
    this.opponentHandler.handleDisconnected(() => {
      this.opponentHandler.showWaitingDialog(60, async () => {
        await this.opponentHandler.handleTimeoutWin((winner, reason) => {
          this.callbacksHandler.handleGameEnd(winner, reason, undefined, () => {
            window.location.href = getWebRoot() + 'index.html';
          });
        });
      });
    });
  }
  private showCountRequestDialog(from: string): void {
    this.dialogRenderer.showCountRequestDialog(
      from,
      async () => {
        this.closeDialog();
        try {
          this.showCountingOverlay();
          await this.gameController.respondCount(true);
          this.updateStatus('同意数子，开始分析...');
        } catch (error) {
          this.hideCountingOverlay();
          // 错误已在 gameController 中处理
        }
      },
      async () => {
        this.closeDialog();
        try {
          await this.gameController.respondCount(false);
          this.updateStatus('已拒绝数子请求');
        } catch (error) {
          // 错误已在 gameController 中处理
        }
      }
    );
  }
  private showCountingOverlay(): void {
    const overlay = document.getElementById('countingOverlay');
    if (overlay) {
      (overlay as HTMLElement).style.display = 'flex';
    }
  }
  private hideCountingOverlay(): void {
    const overlay = document.getElementById('countingOverlay');
    if (overlay) {
      (overlay as HTMLElement).style.display = 'none';
    }
  }
  private showLoadingOverlay(text?: string): void {
    const overlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    if (overlay) {
      if (text && loadingText) {
        loadingText.textContent = text;
      }
      (overlay as HTMLElement).style.display = 'flex';
    }
  }
  private hideLoadingOverlay(): void {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
      (overlay as HTMLElement).style.display = 'none';
    }
  }
  private showUndoRequestDialog(from: string): void {
    this.dialogRenderer.showUndoRequestDialog(
      from,
      async () => {
        this.closeDialog();
        try {
          await this.gameController.respondUndo(true);
          this.updateStatus('同意悔棋');
        } catch (error) {
          // 错误已在 gameController 中处理
        }
      },
      async () => {
        this.closeDialog();
        try {
          await this.gameController.respondUndo(false);
          this.updateStatus('已拒绝悔棋请求');
        } catch (error) {
          // 错误已在 gameController 中处理
        }
      }
    );
  }
  // ========== 渲染 ==========
  private renderBoard(): void {
    const state = this.hhPlayApp.getState();
    this.boardRenderer.render(state, this.selectedPosition, this.myColor);
  }
  private renderPlayers(): void {
    const state = this.hhPlayApp.getState();
    const renderState: HHRenderState = {
      blackName: state.me?.color === 'black' ? state.me.name : (state.opponent?.name || '黑方'),
      whiteName: state.me?.color === 'white' ? state.me.name : (state.opponent?.name || '白方'),
      blackTime: this.blackTime,
      whiteTime: this.whiteTime,
      currentPlayer: state.currentPlayer,
      moveCount: state.moveHistory.length,
      statusMessage: this.getStatusMessage(state),
      inGame: state.inGame,
    };
    renderHHState(renderState);
  }
  private getStatusMessage(state: any): string {
    if (!state.inGame) return '点击下方按钮开始';
    if (state.gameEnded) return '对局已结束';
    if (state.currentPlayer === this.myColor) return '轮到你落子';
    return '等待对手落子';
  }
  private updateStatus(msg: string): void {
    const statusEl = document.getElementById('gameStatus');
    if (statusEl) {
      statusEl.textContent = msg;
    }
  }
  render(): void {
    this.renderBoard();
    this.renderPlayers();
    const state = this.hhPlayApp.getState();
    const isMyTurn = state.currentPlayer === this.myColor;
    this.toolbarManager.updateButtonState(state.inGame && !state.gameEnded, isMyTurn, state.moveHistory.length > 0);
    updateButtons(state.inGame && !state.gameEnded, isMyTurn, state.moveHistory.length > 0);
  }
  destroy(): void {
    this.opponentHandler.destroy();
    this.board.destroy();
    this.toast.destroy();
    this.dialog.destroy();
    this.initialized = false;
  }
}
