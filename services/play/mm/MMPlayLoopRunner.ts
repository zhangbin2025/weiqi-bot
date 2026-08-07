/**
 * @fileoverview AI 自对弈循环执行器
 * @description 封装自动对弈循环逻辑
 */

import type { AIController } from '../../ai/AIController';
import type { AutoPlayController } from './AutoPlayController';
import type { MMStateManager } from './MMStateManager';
import type { MMPlayNotifier } from './MMPlayNotifier';
import type { IMMPlayConfig, PlayerColor } from './types';
import type { BoardState } from '../../../domain/board';
import { Game } from '../../../domain/game';

/**
 * 自动对弈循环执行器
 * @description 管理自动对弈循环、落子执行、暂停/恢复
 */
export class MMPlayLoopRunner {
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private pauseRequested: boolean = false;
  private consecutivePasses: number = 0; // 连续 pass 计数器

  constructor(
    private aiController: AIController,
    private stateManager: MMStateManager,
    private controller: AutoPlayController,
    private notifier: MMPlayNotifier
  ) {}

  /**
   * 运行自动对弈循环
   */
  async runLoop(config: IMMPlayConfig, saveDraft: () => Promise<void>): Promise<void> {
    this.isRunning = true;
    this.isPaused = false;
    this.consecutivePasses = 0; // 重置 pass 计数器

    while (this.isRunning && !this.stateManager.isGameEnded()) {
      const success = await this.executeMove(config, saveDraft);

      // 暂停请求检查
      if (this.pauseRequested) {
        await this.waitForResume();
        this.isPaused = false;
        this.pauseRequested = false;
        continue;
      }

      if (!success) break;

      // 速度延迟
      const delay = this.controller.getDelay();
      if (delay > 0) {
        await this.sleep(delay);
      }
    }

    this.isRunning = false;
  }

  /**
   * 执行单步落子
   */
  async executeMove(config: IMMPlayConfig, saveDraft: () => Promise<void>): Promise<boolean> {
    try {
      const currentPlayer = this.stateManager.getCurrentPlayer();
      const moveHistory = this.stateManager.getMoveHistory().map((m) => ({
        x: m.x,
        y: m.y,
        player: m.color,
      }));

      // ✅ 计算 previousBoard（用于 KataGo 判断打劫）
      // 如果 moveHistory 不为空，重放到倒数第二步
      let previousBoard = null;
      if (moveHistory.length > 0) {
        const game = new Game();
        game.newGame({ size: 19, komi: this.stateManager.getKomi() });
        
        // 重放到倒数第二步
        for (let i = 0; i < moveHistory.length - 1; i++) {
          const move = moveHistory[i]!;
          if (move.x === -1 && move.y === -1) {
            game.pass();
          } else {
            game.placeStone(move.x, move.y);
          }
        }
        
        previousBoard = game.getBoard().getState();
      }

      const move = await this.aiController.genmove(
        this.stateManager.getBoard(),
        previousBoard as BoardState | null,
        currentPlayer,
        moveHistory,
        this.stateManager.getKomi(),
        config.visits  // 直接传 visits
      );

      if (!move) {
        // AI 选择 pass（停一手）
        if (this.pauseRequested) return false;
        
        this.consecutivePasses++;
        console.log(`[MMPlayLoopRunner] AI pass，连续 pass 次数: ${this.consecutivePasses}`);
        
        // 检查是否双方连续 pass
        if (this.consecutivePasses >= 2) {
          // 双方连续 pass，对局结束
          console.log('[MMPlayLoopRunner] 双方连续 pass，对局结束');
          this.stateManager.endGame();
          this.notifyGameEnd();
          return false;
        }
        
        // 只有一方 pass，继续对局
        // 记录 pass 到历史（使用特殊坐标 x=-1, y=-1 表示 pass）
        this.stateManager.placeStone(-1, -1, currentPlayer);
        this.stateManager.switchPlayer();
        this.controller.switchPlayer();
        
        const currentMove = this.stateManager.getCurrentMove();
        this.notifier.notifyPlayerChange(this.stateManager.getCurrentPlayer());
        this.notifier.notifyMove(-1, -1, currentPlayer, currentMove);
        
        // 保存草稿
        await saveDraft();
        
        return true;
      }

      // 有落子，重置 pass 计数器
      this.consecutivePasses = 0;

      // ✅ 执行落子并获取提子信息
      const placeResult = this.stateManager.placeStone(move.x, move.y, currentPlayer);
      const captured = placeResult.captured;
      
      this.stateManager.switchPlayer();
      this.controller.switchPlayer();

      const currentMove = this.stateManager.getCurrentMove();
      this.notifier.notifyBoardChange(this.stateManager.getBoard());
      this.notifier.notifyPlayerChange(this.stateManager.getCurrentPlayer());
      this.notifier.notifyMove(move.x, move.y, currentPlayer, currentMove, captured);

      // 保存草稿
      await saveDraft();

      if (config.maxMoves && currentMove >= config.maxMoves) {
        this.stateManager.endGame();
        this.notifyGameEnd();
        return false;
      }

      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('canceled')) {
        return false;
      }
      console.error('[MMPlayLoopRunner] executeMove 错误:', error);
      this.notifier.notifyError(error as Error);
      return false;
    }
  }

  /**
   * 请求暂停
   */
  requestPause(): void {
    this.pauseRequested = true;
    this.isPaused = true;  // UI 状态显示
    this.aiController.cancel();
  }

  /**
   * 请求恢复
   */
  requestResume(): void {
    this.isPaused = false;
    this.pauseRequested = false;
  }

  /**
   * 停止循环
   */
  stop(): void {
    this.isRunning = false;
    this.isPaused = false;
    this.pauseRequested = false;
  }

  /**
   * 检查是否运行中
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * 检查是否暂停
   */
  getIsPaused(): boolean {
    return this.isPaused;
  }

  /**
   * 通知对局结束
   */
  private notifyGameEnd(): void {
    const scores = this.stateManager.getScores();
    const blackScore = scores.black ?? 0;
    const whiteScore = scores.white ?? 0;
    const winner: PlayerColor = blackScore > whiteScore ? 'black' : 'white';
    this.notifier.notifyGameEnd(blackScore, whiteScore, winner);
  }

  /**
   * 等待恢复
   */
  private waitForResume(): Promise<void> {
    return new Promise((resolve) => {
      const checkResume = () => {
        if (!this.isPaused) {
          resolve();
        } else {
          setTimeout(checkResume, 50);
        }
      };
      checkResume();
    });
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
