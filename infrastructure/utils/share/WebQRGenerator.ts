/**
 * Web端二维码生成器
 * 使用 QRCode.js 库动态加载生成二维码
 * @module infrastructure/utils/share/WebQRGenerator
 */

import type { IQRGenerator, QRGeneratorOptions } from './IQRGenerator.js';

/**
 * QRCode.js 库类型声明
 */
declare global {
  interface Window {
    QRCode?: {
      new(container: HTMLElement, options: {
        width: number;
        height: number;
        colorDark: string;
        colorLight: string;
      }): {
        makeCode(content: string): void;
        clear(): void;
      };
    };
  }
}

/**
 * Web端二维码生成器实现
 *
 * 特性：
 * - 自动动态加载 QRCode.js 库
 * - 使用 WeakMap 管理实例，避免内存泄漏
 * - 支持自定义样式选项
 */
export class WebQRGenerator implements IQRGenerator {
  private qrInstances: WeakMap<HTMLElement, { makeCode(content: string): void; clear(): void }> = new WeakMap();

  /**
   * 生成二维码到指定容器
   */
  async generate(container: HTMLElement, content: string, options?: QRGeneratorOptions): Promise<void> {
    const QRCode = await this.loadQRCodeLib();
    if (!QRCode) {
      throw new Error('QRCode library not available');
    }

    // 清除已有
    this.clear(container);

    const qr = new QRCode(container, {
      width: options?.width ?? 200,
      height: options?.height ?? 200,
      colorDark: options?.colorDark ?? '#000000',
      colorLight: options?.colorLight ?? '#ffffff',
    });

    qr.makeCode(content);
    this.qrInstances.set(container, qr);
  }

  /**
   * 清除二维码
   */
  clear(container: HTMLElement): void {
    container.innerHTML = '';
    this.qrInstances.delete(container);
  }

  /**
   * 检查是否可用
   */
  isAvailable(): boolean {
    return typeof window !== 'undefined';
  }

  /**
   * 动态加载 QRCode.js 库
   */
  private async loadQRCodeLib(): Promise<typeof window.QRCode | null> {
    if (typeof window === 'undefined') return null;
    if (window.QRCode) return window.QRCode;

    // 动态加载 QRCode.js
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
      script.onload = () => resolve(window.QRCode || null);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
  }
}
