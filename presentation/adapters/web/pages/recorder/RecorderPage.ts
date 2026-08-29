/**
 * 记谱工具页面控制器
 */
import { WebBoard } from '../../components/Board';
import { WebDialog } from '../../components/Dialog';
import { AdapterFactory } from '../../../../adapters';
import type { PlayerColor } from '../../../../../domain/primitives';
import type { IPage, PageParams } from '../../../../core/interfaces';
import type { BoardSize } from '../../../../core/types';
import type { RecorderApp } from '../../../../../application/recorder';

export interface RecorderPageConfig {
  recorderApp: RecorderApp;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
}

export class RecorderPage implements IPage {
  readonly title = '记谱工具';
  private recorderApp: RecorderApp;
  private board: WebBoard;
  private dialog: WebDialog;
  private toast: ReturnType<typeof AdapterFactory.createToast>;
  private onNavigate: ((page: string, params?: Record<string, string>) => void) | undefined;
  private boardSize: BoardSize = 19;
  private initialized = false;
  private mode: 'play' | 'setup' = 'play';
  private setupColor: 'B' | 'W' = 'B';
  private setupTool: 'stone' | 'eraser' = 'stone';

  constructor(config: RecorderPageConfig) {
    this.recorderApp = config.recorderApp;
    this.onNavigate = config.onNavigate;
    this.board = new WebBoard();
    this.dialog = new WebDialog();
    this.toast = AdapterFactory.createToast();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.board.initialize({ size: this.boardSize, showCoordinates: false });
    this.board.on({ onClick: (pos) => this.handleStoneClick(pos) });

    try {
      const draftResult = await this.recorderApp.loadDraft();
      const state = this.recorderApp.getState();
      if (state.moveHistory.length > 0 || state.initialStones.length > 0) {
        this.renderBoard();
      }
      if (draftResult && draftResult.mode === 'setup') {
        this.mode = 'setup';
        this.switchToSetupMode();
      }
    } catch (e) {}

    this.initialized = true;
  }

  handleParams(params: PageParams): void {}

  private handleStoneClick(pos: { x: number; y: number }): void {
    if (this.mode === 'setup') {
      if (this.setupTool === 'stone') {
        const success = this.recorderApp.addInitialStone(pos.x, pos.y, this.setupColor);
        if (success) this.renderBoard();
      } else {
        const success = this.recorderApp.removeInitialStone(pos.x, pos.y);
        if (success) this.renderBoard();
      }
    } else {
      const result = this.recorderApp.placeStone(pos.x, pos.y);
      if (result.success) {
        this.recorderApp.playSound(result.captured.length > 0 ? 'capture' : 'stone');
        this.renderBoard();
      }
    }
  }

  private renderBoard(): void {
    const state = this.recorderApp.getState();
    const gameBoard = state.board;
    const size = gameBoard.size;
    this.board.clear();
    const stones: Array<{ pos: { x: number; y: number }; color: PlayerColor | null }> = [];
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        const stone = gameBoard.getStone(x, y);
        if (stone) stones.push({ pos: { x, y }, color: stone });
      }
    }
    this.board.setStones(stones);
    if (state.lastMove) {
      this.board.highlight({ x: state.lastMove.x, y: state.lastMove.y }, 'last');
    }
  }

  switchToSetupMode(): void {
    const state = this.recorderApp.getState();
    if (state.moveHistory.length > 0) {
      this.toast.warning('已有落子记录，不能切换到摆子模式');
      return;
    }
    this.mode = 'setup';
    this.recorderApp.saveDraft('setup').catch(e => console.error('保存草稿失败', e));
    
    const setupModeMenuItem = document.getElementById('setupModeMenuItem');
    const playModeMenuItem = document.getElementById('playModeMenuItem');
    if (setupModeMenuItem) setupModeMenuItem.classList.add('hidden');
    if (playModeMenuItem) playModeMenuItem.classList.remove('hidden');
    
    const modeIndicator = document.getElementById('modeIndicator');
    if (modeIndicator) {
      modeIndicator.textContent = '摆子模式';
      modeIndicator.classList.add('setup-mode');
    }
    
    const setupTools = document.getElementById('setupTools');
    if (setupTools) setupTools.classList.add('visible');
    
    const undoBtn = document.getElementById('undoBtn');
    if (undoBtn) undoBtn.style.display = 'none';
    
    const moveCountDisplay = document.getElementById('moveCountDisplay');
    if (moveCountDisplay) moveCountDisplay.style.display = 'none';
    
    const passMenuItem = document.getElementById('passMenuItem') as HTMLButtonElement;
    if (passMenuItem) passMenuItem.disabled = true;
  }

  switchToPlayMode(): void {
    const state = this.recorderApp.getState();
    const hasWhiteStones = state.initialStones.some(s => s.color === 'W');
    if (hasWhiteStones) {
      this.toast.warning('已放置白子，不能切换到对局模式（死活题请直接保存）');
      return;
    }
    this.mode = 'play';
    this.recorderApp.saveDraft('play').catch(e => console.error('保存草稿失败', e));
    
    const setupModeMenuItem = document.getElementById('setupModeMenuItem');
    const playModeMenuItem = document.getElementById('playModeMenuItem');
    if (setupModeMenuItem) setupModeMenuItem.classList.remove('hidden');
    if (playModeMenuItem) playModeMenuItem.classList.add('hidden');
    
    const modeIndicator = document.getElementById('modeIndicator');
    if (modeIndicator) {
      modeIndicator.textContent = '对局模式';
      modeIndicator.classList.remove('setup-mode');
    }
    
    const setupTools = document.getElementById('setupTools');
    if (setupTools) setupTools.classList.remove('visible');
    
    const undoBtn = document.getElementById('undoBtn');
    if (undoBtn) undoBtn.style.display = '';
    
    const moveCountDisplay = document.getElementById('moveCountDisplay');
    if (moveCountDisplay) moveCountDisplay.style.display = '';
    
    const passMenuItem = document.getElementById('passMenuItem') as HTMLButtonElement;
    if (passMenuItem) passMenuItem.disabled = false;

    if (state.initialStones.length > 0) {
      this.recorderApp.setInitialPlayer('white');
    }
  }

  setSetupColor(color: 'B' | 'W'): void {
    this.setupColor = color;
  }

  setSetupTool(tool: 'stone' | 'eraser'): void {
    this.setupTool = tool;
  }

  clearInitialStones(): void {
    const state = this.recorderApp.getState();
    for (const stone of state.initialStones) {
      this.recorderApp.removeInitialStone(stone.x, stone.y);
    }
    this.renderBoard();
  }

  undo(): void {
    const state = this.recorderApp.getState();
    if (state.moveHistory.length === 0) return;
    if (this.recorderApp.undo()) {
      this.recorderApp.playSound('undo');
      this.renderBoard();
    }
  }

  pass(): void {
    this.recorderApp.pass();
    this.recorderApp.playSound('pass');
  }

  async newGame(options?: { skipConfirm?: boolean }): Promise<void> {
    const state = this.recorderApp.getState();
    if (!options?.skipConfirm && (state.moveHistory.length > 0 || state.initialStones.length > 0)) {
      const result = await this.dialog.show({
        type: 'confirm',
        title: '清空棋盘',
        content: '是否保存当前棋谱？',
        confirmText: '保存',
        cancelText: '不保存',
      });
      if (result === true) {
        const saveModal = document.getElementById('saveModal');
        if (saveModal) {
          saveModal.classList.add('visible');
          const blackNameInput = document.getElementById('blackNameInput') as HTMLInputElement;
          blackNameInput?.focus();
        }
        return;
      } else if (result === undefined) {
        return;
      }
    }
    await this.recorderApp.clearDraft();
    this.recorderApp.newGame({ size: this.boardSize });
    this.board.clear();
    this.mode = 'play';
    this.switchToPlayMode();
  }

  async saveToHistory(blackName: string, whiteName: string): Promise<void> {
    const state = this.recorderApp.getState();
    if (state.moveHistory.length === 0) {
      const result = await this.dialog.show({
        type: 'confirm',
        title: '选择先手方',
        content: '当前没有落子记录，请选择先手方：',
        confirmText: '⚫ 黑先',
        cancelText: '⚪ 白先',
      });
      if (result === true) {
        this.recorderApp.setInitialPlayer('black');
      } else if (result === false) {
        this.recorderApp.setInitialPlayer('white');
      } else {
        return;
      }
    }
    const metadata = { blackName: blackName || '黑方', whiteName: whiteName || '白方' };
    const id = await this.recorderApp.saveToHistory(metadata);
    if (id) {
      this.toast.success('棋谱已保存');
    } else {
      this.toast.error('保存失败');
    }
  }

  async downloadSGF(): Promise<void> {
    const state = this.recorderApp.getState();
    if (state.moveHistory.length === 0 && state.initialStones.length === 0) return;
    const dateStr = new Date().toISOString().split('T')[0] ?? '';
    const metadata = { blackName: '黑方', whiteName: '白方', date: dateStr };
    await this.recorderApp.downloadSGF(metadata);
  }

  async copySGF(): Promise<void> {
    const state = this.recorderApp.getState();
    if (state.moveHistory.length === 0 && state.initialStones.length === 0) return;
    const sgf = this.recorderApp.generateSGF();
    try {
      await navigator.clipboard.writeText(sgf);
    } catch (e) {
      console.error('复制失败', e as Error);
    }
  }

  render(): void {
    this.board.render();
  }

  destroy(): void {
    this.board.destroy();
    this.dialog.destroy();
    this.toast.destroy();
    this.initialized = false;
  }
}
