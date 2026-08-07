import type { PlayerColor } from '../primitives';
import type { IBoard, BoardState } from '../board';
import type { MoveOrPass } from '../move';
import type { ICoordinate } from '../coordinate';

/**
 * 游戏阶段
 */
export type GamePhase = 'playing' | 'ended';

/**
 * 游戏状态接口
 * @ai-example
 * const state: IGameState = {
 *   board: new Board(19),
 *   currentPlayer: 'black',
 *   moveHistory: [],
 *   phase: 'playing',
 *   capturedBlack: 0,
 *   capturedWhite: 0
 * };
 */
export interface IGameState {
  /** 棋盘 */
  readonly board: IBoard;
  /** 当前执棋方 */
  readonly currentPlayer: PlayerColor;
  /** 着法历史 */
  readonly moveHistory: readonly MoveOrPass[];
  /** 游戏阶段 */
  readonly phase: GamePhase;
  /** 黑方提子数 */
  readonly capturedBlack: number;
  /** 白方提子数 */
  readonly capturedWhite: number;
  /** 打劫状态 */
  readonly koPosition: ICoordinate | null;
  /** 让子数 */
  readonly handicap: number;
  /** 贴目 */
  readonly komi: number;
  /** 最后一手 */
  readonly lastMove: ICoordinate | null;
}

/**
 * 落子结果接口
 * @ai-example
 * const result: IMoveResult = { success: true, captured: [{ x: 3, y: 3 }] };
 */
export interface IMoveResult {
  /** 是否成功 */
  readonly success: boolean;
  /** 被提的棋子 */
  readonly captured: readonly ICoordinate[];
  /** 错误信息 */
  readonly error?: string;
}