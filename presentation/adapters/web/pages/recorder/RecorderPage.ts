/**
 * 记谱工具页面控制器
 * @module presentation/pages/recorder/RecorderPage
 * @description 参考 ReplayPage 的简洁设计，专注于记谱核心功能
 */
import { WebBoard } from '../../components/Board';
import { WebDialog } from '../../components/Dialog';
import { AdapterFactory } from '../../../../adapters';
import { isPass } from '../../../../../domain/move';
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
  constructor(config: RecorderPageConfig) {
    this.recorderApp = config.recorderApp;
    this.onNavigate = config.onNavigate;
    // 直接创建组件
    this.board = new WebBoard();
    this.dialog = new WebDialog();
    this.toast = AdapterFactory.createToast();
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    // 初始化棋盘
    this.board.initialize({ size: this.boardSize, showCoordinates: false });
    this.board.on({ onClick: (pos) => this.handleStoneClick(pos) });
    // 尝试加载草稿
    try {
      await this.recorderApp.loadDraft();
      const state = this.recorderApp.getState();
      if (state.moveHistory.length > 0) {
        this.renderBoard();
      }
    } catch (e) {
      // 无草稿或加载失败，忽略
    }
    this.initialized = true;
  }
  handleParams(params: PageParams): void {
    // 不支持参数
  }
  /** 处理落子点击 */
  private handleStoneClick(pos: { x: number; y: number }): void {
    const result = this.recorderApp.placeStone(pos.x, pos.y);
    if (result.success) {
      this.recorderApp.playSound(result.captured.length > 0 ? 'capture' : 'stone');
      this.renderBoard();
    }
  }
  /** 渲染棋盘（从状态同步到棋盘组件） */
  private renderBoard(): void {
    const state = this.recorderApp.getState();
    const gameBoard = state.board;
    const size = gameBoard.size;
    // 清空棋盘
    this.board.clear();
    // 从 Game 的棋盘状态同步所有棋子（包括提子后的状态）
    const stones: Array<{ pos: { x: number; y: number }; color: PlayerColor | null }> = [];
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        const stone = gameBoard.getStone(x, y);
        if (stone) {
          stones.push({ pos: { x, y }, color: stone });
        }
      }
    }
    this.board.setStones(stones);
    // 标记最后一手
    if (state.lastMove) {
      this.board.highlight({ x: state.lastMove.x, y: state.lastMove.y }, 'last');
    }
  }
  /** 撤销 */
  undo(): void {
    const state = this.recorderApp.getState();
    if (state.moveHistory.length === 0) {
      return;
    }
    if (this.recorderApp.undo()) {
      this.recorderApp.playSound('undo');
      this.renderBoard();
    }
  }
  /** 停一手 */
  pass(): void {
    this.recorderApp.pass();
    this.recorderApp.playSound('pass');
  }
  /** 新对局（清空棋盘） */
  async newGame(): Promise<void> {
    const state = this.recorderApp.getState();
    // 检查当前是否有落子
    if (state.moveHistory.length > 0) {
      const result = await this.dialog.show({
        type: 'confirm',
        title: '清空棋盘',
        content: '是否保存当前棋谱？',
        confirmText: '保存',
        cancelText: '不保存',
      });
      if (result === true) {
        // 用户选择保存，显示保存弹框
        const saveModal = document.getElementById('saveModal');
        if (saveModal) {
          saveModal.classList.add('show');
          const blackNameInput = document.getElementById('blackNameInput') as HTMLInputElement;
          blackNameInput?.focus();
        }
        return; // 不清空，等待保存完成
      } else if (result === undefined) {
        // 用户取消
        return;
      }
    }
    // 清理草稿并新建
    await this.recorderApp.clearDraft();
    this.recorderApp.newGame({ size: this.boardSize });
    this.board.clear();
  }
  /** 保存棋谱到历史 */
  async saveToHistory(blackName: string, whiteName: string): Promise<void> {
    const metadata = {
      blackName: blackName || '黑方',
      whiteName: whiteName || '白方',
    };
    const id = await this.recorderApp.saveToHistory(metadata);
    if (id) {
      this.toast.success('棋谱已保存');
    } else {
      this.toast.error('保存失败');
    }
  }
  /** 下载 SGF */
  async downloadSGF(): Promise<void> {
    const state = this.recorderApp.getState();
    if (state.moveHistory.length === 0) {
      return;
    }
    const dateStr = new Date().toISOString().split('T')[0] ?? '';
    const metadata = {
      blackName: '黑方',
      whiteName: '白方',
      date: dateStr,
    };
    const result = await this.recorderApp.downloadSGF(metadata);
    // 不显示 toast
  }
  /** 复制 SGF 到剪贴板 */
  async copySGF(): Promise<void> {
    const state = this.recorderApp.getState();
    if (state.moveHistory.length === 0) {
      return;
    }
    const sgf = this.recorderApp.generateSGF();
    try {
      await navigator.clipboard.writeText(sgf);
      // 不显示 toast
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
