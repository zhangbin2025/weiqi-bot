import type { PlayerColor } from '../primitives';
import type { IGameState, IMoveResult } from './IGameState';
import type { IBoard } from '../board';

/**
 * 游戏配置接口
 * @ai-example
 * const config: IGameConfig = {
 *   size: 19,
 *   komi: 7.5,
 *   handicap: 0,
 *   playerColor: 'black'
 * };
 */
export interface IGameConfig {
  /** 棋盘大小 */
  readonly size?: number;
  /** 贴目 */
  readonly komi?: number;
  /** 让子数 */
  readonly handicap?: number;
  /** 玩家执黑还是执白 */
  readonly playerColor?: PlayerColor;
}

/**
 * 游戏接口
 * @ai-example
 * const game: IGame = {
 *   getState: () => state,
 *   placeStone: (x, y) => ({ success: true, captured: [] }),
 *   pass: () => {},
 *   undo: () => {}
 * };
 */
export interface IGame {
  /**
   * 获取当前游戏状态
   */
  getState(): IGameState;
  /**
   * 落子
   * @param x - X 坐标
   * @param y - Y 坐标
   */
  placeStone(x: number, y: number): IMoveResult;
  /**
   * 停一手
   */
  pass(): void;
  /**
   * 悔棋
   * @returns 是否成功
   */
  undo(): boolean;
  /**
   * 重新开始
   * @param config - 游戏配置
   */
  newGame(config?: IGameConfig): void;
  /**
   * 设置自定义让子棋子
   * @param stones - 让子棋子数组
   */
  setHandicapStones(stones: Array<{ x: number; y: number; color: 'B' | 'W' }>): void;
  /**
   * 获取棋盘
   */
  getBoard(): IBoard;

  /**
   * 检查是否可以落子（不改变状态）
   * @param x - X 坐标
   * @param y - Y 坐标
   * @returns 是否可以落子
   */
  canPlaceStone(x: number, y: number): boolean;

  /**
   * 获取初始让子棋子位置
   * @returns 让子棋子数组（如果没有让子则返回空数组）
   */
  getHandicapStones(): Array<{ x: number; y: number; color: 'B' | 'W' }>;
}