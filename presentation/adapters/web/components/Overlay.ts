/**
 * Web 遮罩层实现
 * @module presentation/adapters/web/components/Overlay
 */
import type { IOverlay } from '../../../core/interfaces';
export class WebOverlay implements IOverlay {
  private element: HTMLElement;
  private mounted = false;
  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'web-overlay';
    this.element.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;' +
      'display:none;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.4);';
  }
  show(): void {
    this.element.style.display = 'flex';
    this.render();
  }
  hide(): void {
    this.element.style.display = 'none';
  }
  setContent(content: string): void {
    this.element.innerHTML = content;
  }
  setProgress(percent: number, message: string): void {
    // formatter 提供 HTML，直接设置内容即可
    // percent / message 保留接口语义，具体 HTML 由 formatter.formatProgress 产出
    void percent;
    void message;
  }
  render(): void {
    if (!this.mounted && document.body && !document.body.contains(this.element)) {
      document.body.appendChild(this.element);
      this.mounted = true;
    }
  }
  destroy(): void {
    this.element.remove();
    this.mounted = false;
  }
}
