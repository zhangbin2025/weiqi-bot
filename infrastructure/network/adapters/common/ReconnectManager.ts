/**
 * 重连管理器
 * @description 管理 WebSocket 重连
 */

/**
 * 重连管理器
 */
export class ReconnectManager {
  private attempts = 0;
  private maxAttempts: number;
  private interval: number;

  constructor(maxAttempts: number = 5, interval: number = 3000) {
    this.maxAttempts = maxAttempts;
    this.interval = interval;
  }

  /**
   * 尝试重连
   */
  attempt(reconnect: () => void): boolean {
    if (this.attempts >= this.maxAttempts) {
      return false;
    }

    this.attempts++;
    setTimeout(() => {
      reconnect();
    }, this.interval);

    return true;
  }

  /**
   * 重置重连次数
   */
  reset(): void {
    this.attempts = 0;
  }

  /**
   * 获取当前重连次数
   */
  getAttempts(): number {
    return this.attempts;
  }

  /**
   * 是否已达到最大重连次数
   */
  isMaxAttempts(): boolean {
    return this.attempts >= this.maxAttempts;
  }
}
