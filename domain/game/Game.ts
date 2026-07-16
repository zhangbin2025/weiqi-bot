import type { PlayerColor } from '../primitives';
import type { IGameState, IMoveResult } from './IGameState';
import type { IGame, IGameConfig } from './IGame';
import { Board } from '../board';
import { createMove, createPassMove, isPass, getMoveCoordinate, type MoveOrPass } from '../move';
import { createCoordinate, type ICoordinate } from '../coordinate';
import { getOpponentColor } from '../primitives';
import { LibertyCalculator, CaptureRule, SuicideRule, KoRule } from '../rules';

/** 游戏实现：管理对局状态和流程 */
export class Game implements IGame {
  private board: Board;
  private currentPlayer: PlayerColor = 'black';
  private moveHistory: MoveOrPass[] = [];
  private phase: 'playing' | 'ended' = 'playing';
  private capturedBlack = 0;
  private capturedWhite = 0;
  private koPosition: ICoordinate | null = null;
  private handicap: number;
  private komi: number;
  private consecutivePasses = 0;
  private libertyCalc = new LibertyCalculator();
  private captureRule = new CaptureRule();
  private suicideRule = new SuicideRule();
  private koRule = new KoRule();
  private handicapStones: Array<{ x: number; y: number; color: 'B' | 'W' }> = [];

  constructor(config?: IGameConfig) {
    this.board = new Board(config?.size ?? 19);
    this.handicap = config?.handicap ?? 0;
    this.komi = config?.komi ?? 7.5;
  }

  getState(): IGameState {
    const lastMove = this.moveHistory.length > 0
      ? getMoveCoordinate(this.moveHistory[this.moveHistory.length - 1]!)
      : null;
    
    return {
      board: this.board,
      currentPlayer: this.currentPlayer,
      moveHistory: this.moveHistory,
      phase: this.phase,
      capturedBlack: this.capturedBlack,
      capturedWhite: this.capturedWhite,
      koPosition: this.koPosition,
      handicap: this.handicap,
      komi: this.komi,
      lastMove,
    };
  }

  placeStone(x: number, y: number): IMoveResult {
    if (this.phase === 'ended') return { success: false, captured: [], error: '对局已结束' };
    if (this.board.getStone(x, y) !== null) return { success: false, captured: [], error: '该位置已有棋子' };
    if (this.koPosition?.x === x && this.koPosition?.y === y) return { success: false, captured: [], error: '打劫禁着点' };
    if (this.suicideRule.isSuicide(this.board, x, y, this.currentPlayer)) return { success: false, captured: [], error: '禁入点' };
    
    this.board.setStone(x, y, this.currentPlayer);
    const captureResult = this.captureRule.capture(this.board, x, y, this.currentPlayer);
    
    if (this.currentPlayer === 'black') this.capturedBlack += captureResult.count;
    else this.capturedWhite += captureResult.count;
    
    for (const cap of captureResult.captured) this.board.setStone(cap.x, cap.y, null);
    
    if (captureResult.count === 1 && captureResult.captured[0]) {
      const koState = this.koRule.detectKo(this.board, 1, captureResult.captured[0]);
      this.koPosition = koState.isActive ? koState.forbiddenPosition : null;
    } else {
      this.koPosition = null;
    }
    
    this.moveHistory.push(createMove(x, y, this.currentPlayer, this.moveHistory.length + 1));
    this.consecutivePasses = 0;
    this.currentPlayer = getOpponentColor(this.currentPlayer);
    return { success: true, captured: captureResult.captured };
  }

  pass(): void {
    if (this.phase === 'ended') return;
    this.moveHistory.push(createPassMove(this.currentPlayer, this.moveHistory.length + 1));
    this.consecutivePasses++;
    this.koPosition = null;
    if (this.consecutivePasses >= 2) { this.phase = 'ended'; return; }
    this.currentPlayer = getOpponentColor(this.currentPlayer);
  }

  undo(): boolean {
    if (this.moveHistory.length === 0) return false;
    this.moveHistory.pop();
    this.board.clear();
    this.currentPlayer = 'black';
    this.capturedBlack = 0;
    this.capturedWhite = 0;
    this.koPosition = null;
    this.phase = 'playing';
    this.consecutivePasses = 0;
    const moves = [...this.moveHistory];
    this.moveHistory = [];
    for (const move of moves) {
      if (!isPass(move)) this.placeStone(move.x, move.y);
      else this.pass();
    }
    return true;
  }

  newGame(config?: IGameConfig): void {
    this.board = new Board(config?.size ?? 19);
    this.currentPlayer = 'black';
    this.moveHistory = [];
    this.phase = 'playing';
    this.capturedBlack = 0;
    this.capturedWhite = 0;
    this.koPosition = null;
    this.handicap = config?.handicap ?? 0;
    this.komi = config?.komi ?? 7.5;
    this.consecutivePasses = 0;
    this.handicapStones = [];
    
    // 放置让子棋子（黑子）
    if (this.handicap > 0) {
      this.placeHandicapStones(this.handicap);
      // 让子情况下，白方先行
      this.currentPlayer = 'white';
    }
  }

  /**
   * 放置让子棋子
   * 标准让子位置（19x19 棋盘的星位）
   */
  private placeHandicapStones(handicap: number): void {
    // 19x19 棋盘的星位坐标
    const starPoints = {
      'topLeft': { x: 3, y: 3 },
      'topRight': { x: 15, y: 3 },
      'bottomLeft': { x: 3, y: 15 },
      'bottomRight': { x: 15, y: 15 },
      'center': { x: 9, y: 9 },
      'left': { x: 3, y: 9 },
      'right': { x: 15, y: 9 },
      'top': { x: 9, y: 3 },
      'bottom': { x: 9, y: 15 },
    };
    
    // 让子位置（按照传统顺序）
    const handicapPositions = [
      // 2 子：对角
      [starPoints.bottomLeft, starPoints.topRight],
      // 3 子：三个角
      [starPoints.bottomLeft, starPoints.topRight, starPoints.bottomRight],
      // 4 子：四个角
      [starPoints.bottomLeft, starPoints.topRight, starPoints.bottomRight, starPoints.topLeft],
      // 5 子：四个角 + 天元
      [starPoints.bottomLeft, starPoints.topRight, starPoints.bottomRight, starPoints.topLeft, starPoints.center],
      // 6 子：四个角 + 左右边星
      [starPoints.bottomLeft, starPoints.topRight, starPoints.bottomRight, starPoints.topLeft, starPoints.left, starPoints.right],
      // 7 子：四个角 + 左右边星 + 天元
      [starPoints.bottomLeft, starPoints.topRight, starPoints.bottomRight, starPoints.topLeft, starPoints.left, starPoints.right, starPoints.center],
      // 8 子：四个角 + 四个边星
      [starPoints.bottomLeft, starPoints.topRight, starPoints.bottomRight, starPoints.topLeft, starPoints.left, starPoints.right, starPoints.top, starPoints.bottom],
      // 9 子：九个星位
      [starPoints.bottomLeft, starPoints.topRight, starPoints.bottomRight, starPoints.topLeft, starPoints.left, starPoints.right, starPoints.top, starPoints.bottom, starPoints.center],
    ];
    
    // 根据让子数选择位置
    const index = Math.min(handicap, 9) - 2;
    if (index >= 0 && index < handicapPositions.length) {
      const positions = handicapPositions[index]!;
      for (const pos of positions) {
        this.board.setStone(pos.x, pos.y, 'black');
        // 保存让子棋子
        this.handicapStones.push({ x: pos.x, y: pos.y, color: 'B' });
      }
    }
  }

  /**
   * 设置自定义让子棋子
   * 用于从 SGF 加载让子棋子（位置可能不是标准位置）
   */
  setHandicapStones(stones: Array<{ x: number; y: number; color: 'B' | 'W' }>): void {
    this.handicap = stones.length;
    this.handicapStones = stones; // 保存让子棋子
    for (const stone of stones) {
      const color = stone.color === 'B' ? 'black' : 'white';
      this.board.setStone(stone.x, stone.y, color);
    }
    // 让子情况下，白方先行
    this.currentPlayer = 'white';
  }

  getBoard(): Board { return this.board; }

  /**
   * 检查是否可以落子（不改变状态）
   */
  canPlaceStone(x: number, y: number): boolean {
    if (this.phase === 'ended') return false;
    if (this.board.getStone(x, y) !== null) return false;
    if (this.koPosition?.x === x && this.koPosition?.y === y) return false;
    if (this.suicideRule.isSuicide(this.board, x, y, this.currentPlayer)) return false;
    return true;
  }

  /**
   * 获取初始让子棋子位置
   * @returns 让子棋子数组（如果没有让子则返回空数组）
   */
  getHandicapStones(): Array<{ x: number; y: number; color: 'B' | 'W' }> {
    return this.handicapStones;
  }
}