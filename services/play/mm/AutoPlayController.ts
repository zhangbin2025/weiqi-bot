/**
 * @fileoverview 自动对弈控制器
 * @description 管理自对弈循环、暂停/继续、速度控制
 */

import type { PlayerColor, PlaySpeed } from './types';

/** 速度延迟映射（毫秒） */
const SPEED_DELAY_MAP: Record<string, number> = {
  instant: 0,   // 极速：无延时
  fast: 100,    // 快速：100ms
  normal: 500,  // 正常：500ms
  slow: 2000,   // 慢速：2000ms
};

/**
 * 自动对弈控制器
 * @ai-example
 * const controller = new AutoPlayController();
 * controller.setSpeed('normal');
 * controller.start(async () => { await makeMove(); });
 */
export class AutoPlayController {
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private stopRequested: boolean = false;
  private speed: PlaySpeed = 'normal';
  private delay: number = SPEED_DELAY_MAP['normal']!;
  private currentPlayer: PlayerColor = 'black';

  /**
   * 设置速度
   * @param speed - 对弈速度
   */
  setSpeed(speed: PlaySpeed): void {
    this.speed = speed;
    this.delay = SPEED_DELAY_MAP[speed]! || SPEED_DELAY_MAP['normal']!;
  }

  /**
   * 设置自定义延迟（毫秒）
   * @param delayMs - 延迟毫秒数
   */
  setDelay(delayMs: number): void {
    this.delay = Math.max(0, Math.min(10000, delayMs));
  }

  /**
   * 获取当前延迟
   */
  getDelay(): number {
    return this.delay;
  }

  /**
   * 获取当前速度
   */
  getSpeed(): PlaySpeed {
    return this.speed;
  }

  /**
   * 获取当前玩家
   */
  getCurrentPlayer(): PlayerColor {
    return this.currentPlayer;
  }

  /**
   * 切换玩家
   */
  switchPlayer(): void {
    this.currentPlayer = this.currentPlayer === 'black' ? 'white' : 'black';
  }

  /**
   * 检查是否运行中
   */
  getIsRunning(): boolean {
    return this.isRunning && !this.isPaused;
  }

  /**
   * 检查是否暂停
   */
  getIsPaused(): boolean {
    return this.isPaused;
  }

  /**
   * 开始自动对弈循环
   * @param moveExecutor - 执行落子的函数
   * @param shouldContinue - 判断是否继续的函数
   */
  async start(
    moveExecutor: () => Promise<boolean>,
    shouldContinue: () => boolean
  ): Promise<void> {
    this.isRunning = true;
    this.isPaused = false;
    this.stopRequested = false;

    while (this.isRunning && !this.stopRequested) {
      // 暂停检查
      if (this.isPaused) {
        await this.waitForResume();
        continue;
      }

      // 检查是否应该继续
      if (!shouldContinue()) {
        this.isRunning = false;
        break;
      }

      // 执行落子
      const success = await moveExecutor();

      // 如果执行失败或请求停止，退出循环
      if (!success || this.stopRequested) {
        break;
      }

      // 速度延迟
      if (this.delay > 0) {
        await this.sleep(this.delay);
      }
    }

    this.isRunning = false;
  }

  /**
   * 暂停
   */
  pause(): void {
    this.isPaused = true;
  }

  /**
   * 继续
   */
  resume(): void {
    this.isPaused = false;
  }

  /**
   * 停止
   */
  stop(): void {
    this.stopRequested = true;
    this.isRunning = false;
    this.isPaused = false;
  }

  /**
   * 等待恢复
   */
  private waitForResume(): Promise<void> {
    return new Promise((resolve) => {
      const checkResume = () => {
        if (!this.isPaused || this.stopRequested) {
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
   * @param ms - 延迟毫秒数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.isRunning = false;
    this.isPaused = false;
    this.stopRequested = false;
    this.currentPlayer = 'black';
  }
}
