/**
 * Web Button 组件
 */
import type { IButton, IButtonConfig } from '../../../core/interfaces';
export class WebButton implements IButton {
  private element: HTMLButtonElement;
  private textElement?: HTMLSpanElement;
  private clickCallback?: () => void;
  constructor(container?: HTMLElement) {
    this.element = document.createElement('button');
    this.element.className = 'web-button';
    this.element.type = 'button';
    this.element.style.cssText = `
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 16px;
      cursor: pointer;
      transition: opacity 0.2s;
      width: 100%;
      margin-top: 12px;
    `;
    if (container) container.appendChild(this.element);
  }
  private currentText = '';
  setText(text: string): void {
    this.currentText = text;
    if (!this.textElement) {
      this.textElement = document.createElement('span');
      this.element.appendChild(this.textElement);
    }
    this.textElement.textContent = text;
  }
  setConfig(config: IButtonConfig): void {
    if (config.variant === 'danger') {
      this.element.style.background = '#ff4d4f';
      this.element.style.width = 'auto';
      this.element.style.marginTop = '0';
      this.element.style.padding = '4px 8px';
      this.element.style.fontSize = '0.85em';
      this.element.style.marginLeft = 'auto';
    }
    if (config.variant === 'secondary') {
      this.element.style.background = '#6c757d';
      this.element.style.width = 'auto';
      this.element.style.marginTop = '0';
      this.element.style.marginBottom = '12px';
      this.element.style.padding = '8px 16px';
      this.element.style.fontSize = '0.9em';
    }
  }
  onClick(callback: () => void): void {
    if (this.clickCallback) this.element.removeEventListener('click', this.clickCallback);
    this.clickCallback = callback;
    this.element.addEventListener('click', callback);
  }
  setDisabled(disabled: boolean): void {
    this.element.disabled = disabled;
    this.element.style.opacity = disabled ? '0.6' : '1';
    this.element.style.cursor = disabled ? 'not-allowed' : 'pointer';
  }
  setLoading(loading: boolean): void {
    this.element.disabled = loading;
    this.element.style.opacity = loading ? '0.7' : '1';
    if (loading) {
      this.element.textContent = '查询中...';
      delete this.textElement;
    } else {
      this.element.textContent = '';
      delete this.textElement;
      this.setText(this.currentText || '开始查询');
    }
  }
  render(): void { /* created in constructor */ }
  destroy(): void {
    if (this.clickCallback) this.element.removeEventListener('click', this.clickCallback);
    this.element.remove();
  }
}
