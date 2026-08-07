/**
 * 提子统计控制器
 * 负责统计和显示双方的提子数
 * @module presentation/core/controllers/CapturedController
 */
import type { IBoard } from '../interfaces/IBoard';
/** 提子统计配置 */
export interface CapturedControllerConfig {
  /** 提子数变化回调 */
  onChange?: (blackCaptured: number, whiteCaptured: number) => void;
}
/**
 * 提子统计控制器
 * 适用场景：复盘、对弈
 */
export class CapturedController {
  private blackCaptured: number = 0;
  private whiteCaptured: number = 0;
  private onChange?: ((blackCaptured: number, whiteCaptured: number) => void) | undefined;
  constructor(config: CapturedControllerConfig = {}) {
    this.onChange = config.onChange;
  }
  /** 更新提子数（从棋盘计算） */
  update(board: IBoard): void {
    // 实际实现中会从棋盘状态计算提子数
    // 这里只是占位，具体实现需要根据棋盘接口调整
  }
  /** 手动设置提子数 */
  setCaptured(blackCaptured: number, whiteCaptured: number): void {
    this.blackCaptured = blackCaptured;
    this.whiteCaptured = whiteCaptured;
    this.onChange?.(this.blackCaptured, this.whiteCaptured);
  }
  /** 增加黑方提子 */
  addBlackCaptured(count: number = 1): void {
    this.blackCaptured += count;
    this.onChange?.(this.blackCaptured, this.whiteCaptured);
  }
  /** 增加白方提子 */
  addWhiteCaptured(count: number = 1): void {
    this.whiteCaptured += count;
    this.onChange?.(this.blackCaptured, this.whiteCaptured);
  }
  /** 获取黑方提子数 */
  getBlackCaptured(): number {
    return this.blackCaptured;
  }
  /** 获取白方提子数 */
  getWhiteCaptured(): number {
    return this.whiteCaptured;
  }
  /** 获取双方提子数 */
  getCaptured(): { black: number; white: number } {
    return {
      black: this.blackCaptured,
      white: this.whiteCaptured,
    };
  }
  /** 重置提子数 */
  reset(): void {
    this.blackCaptured = 0;
    this.whiteCaptured = 0;
    this.onChange?.(this.blackCaptured, this.whiteCaptured);
  }
}
