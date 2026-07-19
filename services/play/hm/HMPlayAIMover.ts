/**
 * 人机对弈 AI 移动逻辑
 * @module services/play/hm/HMPlayAIMover
 */

import type { PlayerColor, BoardState } from '../../../domain';
import type { AIController } from '../../ai/AIController';
import type { HMNotifier } from './HMNotifier';
import type { IGame } from '../../../domain/game/IGame';
import { getBoardState, toSimpleMove } from './HMUtils';

/**
 * AI 移动控制器
 * 负责调用 AI 生成着法并执行
 */
export class HMPlayAIMover {
  private game: IGame;
  private aiController: AIController;
  private notifier: HMNotifier;
  private getPreviousBoard: () => BoardState | null;
  private setPreviousBoard: (board: BoardState | null) => void;

  constructor(
    game: IGame,
    aiController: AIController,
    notifier: HMNotifier,
    getPreviousBoard: () => BoardState | null,
    setPreviousBoard: (board: BoardState | null) => void
  ) {
    this.game = game;
    this.aiController = aiController;
    this.notifier = notifier;
    this.getPreviousBoard = getPreviousBoard;
    this.setPreviousBoard = setPreviousBoard;
  }

  /**
   * 执行 AI 移动
   * @param incrementPasses - 增加虚手计数的回调
   * @param resetPasses - 重置虚手计数的回调
   * @param onSaveDraft - 保存草稿的回调
   * @param visits - AI 计算量（可选，不传则使用 AIController 内部设置）
   */
  async move(
    incrementPasses: () => number,
    resetPasses: () => void,
    onSaveDraft: () => Promise<void>,
    visits?: number
  ): Promise<void> {
    this.notifier.notifyAiThinking(true);

    try {
      // 保存当前棋盘状态用于打劫判断
      const currentBoard = getBoardState(this.game.getState().board);
      
      const state = this.game.getState();
      const moves = this.getMoveHistory();
      
      // 获取初始让子棋子
      const handicapStones = this.game.getHandicapStones();
      const initialStones = handicapStones.map(s => ({
        player: (s.color === 'B' ? 'black' : 'white') as PlayerColor,
        x: s.x,
        y: s.y,
      }));
      
      const move = await this.aiController.genmove(
        currentBoard,
        this.getPreviousBoard(), // 传递 previousBoard
        state.currentPlayer,
        moves,
        state.komi,
        visits, // 直接传 visits
        undefined, // maxTimeMs
        initialStones.length > 0 ? initialStones : undefined
      );

      if (!move) {
        const passes = incrementPasses();
        this.setPreviousBoard(currentBoard); // AI 虚手也需要保存 previousBoard
        this.game.pass();
        this.notifier.notifyPlayerChange(this.game.getState().currentPlayer);
        if (passes >= 2) {
          // 双方虚手，游戏结束
          return;
        }
        return;
      }

      resetPasses();
      this.setPreviousBoard(currentBoard); // AI 落子前保存 previousBoard
      const result = this.game.placeStone(move.x, move.y);

      if (result.success) {
        this.notifier.notifyAiMove(move.x, move.y, move.winRate, move.scoreLead);
        this.notifier.notifyBoardChange(getBoardState(this.game.getState().board));
        if (result.captured.length > 0) {
          this.notifier.notifyCapture(result.captured.length, state.currentPlayer);
        }
        this.notifier.notifyPlayerChange(this.game.getState().currentPlayer);
        
        // 保存草稿
        await onSaveDraft();
      }
    } catch (error) {
      // 忽略取消错误
      if (error instanceof Error && error.message.includes('canceled')) {
        return;
      }
      this.notifier.notifyError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.notifier.notifyAiThinking(false);
    }
  }

  /**
   * 获取移动历史
   */
  private getMoveHistory(): Array<{ x: number; y: number; player: PlayerColor }> {
    return this.game
      .getState()
      .moveHistory.map(toSimpleMove)
      .filter((m): m is { x: number; y: number; player: PlayerColor } => m !== null);
  }
}
