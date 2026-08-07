/**
 * 二维码生成器接口
 * @module infrastructure/utils/share/IQRGenerator
 */

/**
 * 二维码生成选项
 */
export interface QRGeneratorOptions {
  /** 宽度（像素） */
  width?: number;
  /** 高度（像素） */
  height?: number;
  /** 前景色（深色部分） */
  colorDark?: string;
  /** 背景色（浅色部分） */
  colorLight?: string;
}

/**
 * 二维码生成器接口
 *
 * 提供二维码生成和清除功能，支持不同的实现方式
 */
export interface IQRGenerator {
  /**
   * 生成二维码到指定容器
   * @param container - HTML容器元素
   * @param content - 二维码内容
   * @param options - 生成选项
   */
  generate(container: HTMLElement, content: string, options?: QRGeneratorOptions): Promise<void>;

  /**
   * 清除二维码
   * @param container - HTML容器元素
   */
  clear(container: HTMLElement): void;

  /**
   * 检查是否可用
   * @returns 是否在当前环境可用
   */
  isAvailable(): boolean;
}
