/**
 * 心跳管理器
 * @description 管理 WebSocket 心跳
 */

/**
 * 心跳管理器
 */
export class HeartbeatManager {
  private timer: NodeJS.Timeout | null = null;
  private interval: number;

  constructor(interval: number = 30000) {
    this.interval = interval;
  }

  /**
   * 启动心跳
   */
  start(sendHeartbeat: () => void): void {
    this.stop();
    this.timer = setInterval(() => {
      sendHeartbeat();
    }, this.interval);
  }

  /**
   * 停止心跳
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
