/**
 * 运行环境枚举
 * @description 定义项目支持的所有运行环境
 * @ai-example
 * const env = Environment.WEB;
 * console.log(env); // 'web'
 */

/**
 * 运行环境类型
 */
export enum Environment {
  /** Web 浏览器环境 */
  WEB = 'web',

  /** 桌面应用环境（Electron） */
  DESKTOP = 'desktop',

  /** 移动应用环境（React Native） */
  MOBILE = 'mobile',

  /** Node.js 后台环境 */
  BACKEND = 'backend',

  /** 小程序环境（微信/支付宝等） */
  MINIPROGRAM = 'miniprogram'
}

/**
 * 环境检测器接口
 * @description 用于检测当前运行环境
 */
export interface IEnvironmentDetector {
  /**
   * 检测当前运行环境
   * @returns 当前环境类型
   * @ai-example
   * const detector = new EnvironmentDetector();
   * const env = detector.detect(); // Environment.WEB
   */
  detect(): Environment;
}

/**
 * 环境特性描述
 */
export interface EnvironmentCapabilities {
  /** 环境类型 */
  environment: Environment;

  /** 是否有 CORS 限制 */
  hasCORSLimit: boolean;

  /** 是否支持 WebSocket */
  supportsWebSocket: boolean;

  /** 是否支持 WebRTC */
  supportsWebRTC: boolean;

  /** 是否支持 Fetch API */
  supportsFetch: boolean;

  /** 是否支持本地存储 */
  supportsLocalStorage: boolean;
}
