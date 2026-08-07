/**
 * @fileoverview 游戏控制器 - 处理游戏相关操作
 * @description 封装落子、悔棋、停一手、数子、认输等逻辑
 */
import type { HHPlayApp } from '../../../../../../application/play';
import type { IToast, IDialog } from '../../../../../core/interfaces';
import type { PlayerColor, Position } from '../../../../../core/types';
import type { WebBoard } from '../../../components/Board';
/** 游戏控制器配置 */
export interface HHGameControllerConfig {
  hhPlayApp: HHPlayApp;
  board: WebBoard;
  toast: IToast;
  dialog: IDialog;
  myColor: PlayerColor | undefined;
}
/**
 * 游戏控制器
 * @description 负责游戏操作的逻辑处理
 */
export class HHGameController {
  private hhPlayApp: HHPlayApp;
  private board: WebBoard;
  private toast: IToast;
  private dialog: IDialog;
  private myColor: PlayerColor | undefined;
  constructor(config: HHGameControllerConfig) {
    this.hhPlayApp = config.hhPlayApp;
    this.board = config.board;
    this.toast = config.toast;
    this.dialog = config.dialog;
    this.myColor = config.myColor;
  }
  /**
   * 更新我的颜色
   */
  setMyColor(color: PlayerColor | undefined): void {
    this.myColor = color;
  }
  /**
   * 处理点击棋盘
   * @returns 是否选中了一个位置
   */
  async handleClick(pos: Position): Promise<boolean> {
    const state = this.hhPlayApp.getState();
    if (!state.inGame || state.gameEnded) {
      this.toast.warning('请先加入房间');
      return false;
    }
    if (state.currentPlayer !== this.myColor) {
      return false;
    }

    // 检查点击的位置
    const board = state.board;
    const stone = board[pos.y]?.[pos.x];
    if (stone) {
      // 点击已有棋子，清除选中
      return false;
    }

    // 检查是否是合法落子点（禁入点、打劫规则）
    const canPlace = this.hhPlayApp.canMove(pos.x, pos.y);
    if (!canPlace) {
      // 不是合法落子点，不显示预览
      this.toast.info('此处不能落子');
      return false;
    }

    // 点击合法的空位，显示预览
    return true;
  }
  /**
   * 确认落子
   */
  async confirmMove(pos: Position): Promise<void> {
    try {
      await this.hhPlayApp.move(pos.x, pos.y);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`落子失败: ${errorMsg}`, error instanceof Error ? error : new Error(errorMsg));
      this.toast.error('落子失败: ' + errorMsg);
      throw error;
    }
  }
  /**
   * 请求悔棋
   */
  async requestUndo(): Promise<void> {
    await this.hhPlayApp.requestUndo();
  }
  /**
   * 停一手
   */
  async pass(): Promise<void> {
    await this.hhPlayApp.pass();
  }
  /**
   * 申请数子
   * @returns 是否确认申请
   */
  async requestCount(): Promise<boolean> {
    const result = await this.dialog.show({
      type: 'confirm',
      title: '申请数子',
      content: '确定要申请数子结束对局吗？',
    });
    if (result) {
      try {
        await this.hhPlayApp.requestCount();
        return true;
      } catch (error) {
        this.toast.error('发送数子请求失败: ' + (error as Error).message);
        throw error;
      }
    }
    return false;
  }
  /**
   * 认输
   * @returns 是否确认认输
   */
  async resign(): Promise<boolean> {
    const result = await this.dialog.show({
      type: 'confirm',
      title: '认输',
      content: '确认要认输吗？',
    });
    if (result) {
      await this.hhPlayApp.resign();
      return true;
    }
    return false;
  }
  /**
   * 回应数子请求
   */
  async respondCount(agree: boolean): Promise<void> {
    try {
      await this.hhPlayApp.respondCount(agree);
    } catch (error) {
      this.toast.error('操作失败: ' + (error as Error).message);
      throw error;
    }
  }
  /**
   * 回应悔棋请求
   */
  async respondUndo(agree: boolean): Promise<void> {
    try {
      await this.hhPlayApp.respondUndo(agree);
    } catch (error) {
      this.toast.error('操作失败: ' + (error as Error).message);
      throw error;
    }
  }
}
