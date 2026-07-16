/**
 * 平台检测工具
 * @module presentation/adapters/PlatformDetector
 */
/**
 * 支持的平台类型
 */
export type Platform = 'web' | 'electron' | 'cli';
/**
 * 平台检测器
 * 自动检测当前运行平台
 */
export class PlatformDetector {
  private static cachedPlatform: Platform | null = null;
  /**
   * 检测当前平台
   */
  static detect(): Platform {
    if (this.cachedPlatform) {
      return this.cachedPlatform;
    }
    // Web / Electron
    if (typeof window !== 'undefined') {
      // Electron 环境
      if (typeof process !== 'undefined' && process.versions?.['electron']) {
        this.cachedPlatform = 'electron';
      } else {
        this.cachedPlatform = 'web';
      }
      return this.cachedPlatform;
    }
    // CLI 环境 (Node.js)
    if (typeof process !== 'undefined' && process.stdout?.isTTY) {
      this.cachedPlatform = 'cli';
      return this.cachedPlatform;
    }
    // 默认 Web
    this.cachedPlatform = 'web';
    return this.cachedPlatform;
  }
  /**
   * 手动设置平台
   * 用于测试或特殊场景
   */
  static setPlatform(platform: Platform): void {
    this.cachedPlatform = platform;
  }
  /**
   * 重置平台检测缓存
   */
  static reset(): void {
    this.cachedPlatform = null;
  }
  /**
   * 判断是否为浏览器环境
   */
  static isBrowser(): boolean {
    return this.detect() === 'web' || this.detect() === 'electron';
  }
  /**
   * 判断是否为 CLI 环境
   */
  static isCLI(): boolean {
    return this.detect() === 'cli';
  }
}
