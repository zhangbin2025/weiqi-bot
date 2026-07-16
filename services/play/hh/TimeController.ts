/**
 * @fileoverview 时间控制器 - 对弈计时器管理
 */

import type { PlayerColor } from './types';

/** 时间控制器配置 */
export interface ITimeControllerConfig {
  /** 每方用时（分钟） */
  timeLimit: number;
  /** 计时间隔（毫秒） */
  interval?: number;
}

/** 时间控制器回调 */
export interface ITimeControllerCallbacks {
  /** 时间更新回调 */
  onTimeUpdate?: (blackTime: number, whiteTime: number) => void;
  /** 超时回调 */
  onTimeout?: (color: PlayerColor) => void;
}

/**
 * 时间控制器
 * @ai-example
 * const timer = new TimeController({ timeLimit: 30 });
 * timer.setCallbacks({ onTimeout: (color) => console.log(color, '超时') });
 * timer.start();
 * timer.switchPlayer('white');
 */
export class TimeController {
  private blackTime: number;
  private whiteTime: number;
  private currentPlayer: PlayerColor = 'black';
  private interval: ReturnType<typeof setInterval> | null = null;
  private intervalMs: number;
  private callbacks: ITimeControllerCallbacks = {};
  private started = false;

  constructor(config: ITimeControllerConfig) {
    this.blackTime = config.timeLimit * 60;
    this.whiteTime = config.timeLimit * 60;
    this.intervalMs = config.interval ?? 1000;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.interval = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.started = false;
  }

  switchPlayer(player: PlayerColor): void {
    this.currentPlayer = player;
  }

  getTimes(): { blackTime: number; whiteTime: number } {
    return { blackTime: this.blackTime, whiteTime: this.whiteTime };
  }

  setTimes(blackTime: number, whiteTime: number): void {
    this.blackTime = blackTime;
    this.whiteTime = whiteTime;
    this.callbacks.onTimeUpdate?.(blackTime, whiteTime);
  }

  setCallbacks(callbacks: ITimeControllerCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  get currentPlayerTime(): number {
    return this.currentPlayer === 'black' ? this.blackTime : this.whiteTime;
  }

  private tick(): void {
    if (this.currentPlayer === 'black') {
      this.blackTime--;
    } else {
      this.whiteTime--;
    }

    this.callbacks.onTimeUpdate?.(this.blackTime, this.whiteTime);

    // 检查超时
    if (this.blackTime <= 0) {
      this.stop();
      this.callbacks.onTimeout?.('black');
    } else if (this.whiteTime <= 0) {
      this.stop();
      this.callbacks.onTimeout?.('white');
    }
  }
}