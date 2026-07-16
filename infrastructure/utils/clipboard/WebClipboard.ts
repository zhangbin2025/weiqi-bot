/**
 * Web 剪贴板适配器
 * @module infrastructure/utils/clipboard/WebClipboard
 */

import type { IClipboard } from './IClipboard';

/**
 * Web 环境剪贴板实现
 */
export class WebClipboard implements IClipboard {
  async readText(): Promise<string | null> {
    if (!navigator.clipboard?.readText) return null;
    try {
      return await navigator.clipboard.readText();
    } catch {
      return null;
    }
  }

  async writeText(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  }

  isAvailable(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;
  }
}
