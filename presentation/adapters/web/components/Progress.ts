/**
 * Web Progress 组件
 */
import type { IProgress, IProgressConfig } from '../../../core/interfaces';
export class WebProgress implements IProgress {
  private element: HTMLElement;
  private progressBar: HTMLElement;
  private labelElement?: HTMLElement;
  private value = 0;
  private max = 100;
  private config: IProgressConfig = {};
  constructor(container?: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'web-progress';
    this.progressBar = document.createElement('div');
    this.progressBar.className = 'web-progress__bar';
    this.progressBar.style.cssText = `
      height: 8px; background: #f0f0f0;
      border-radius: 4px; overflow: hidden;
    `;
    const innerBar = document.createElement('div');
    innerBar.className = 'web-progress__inner';
    innerBar.style.cssText = `
      height: 100%; background: #1890ff;
      transition: width 0.3s; width: 0%;
    `;
    this.progressBar.appendChild(innerBar);
    this.element.appendChild(this.progressBar);
    if (container) container.appendChild(this.element);
  }
  setValue(value: number): void {
    this.value = Math.max(0, Math.min(value, this.max));
    this.updateBar();
  }
  setMax(max: number): void {
    this.max = max > 0 ? max : 100;
    this.updateBar();
  }
  setConfig(config: IProgressConfig): void {
    this.config = config;
    this.render();
  }
  show(): void {
    this.element.style.display = 'block';
  }
  hide(): void {
    this.element.style.display = 'none';
  }
  private updateBar(): void {
    const innerBar = this.progressBar.querySelector('.web-progress__inner') as HTMLElement;
    if (innerBar) {
      const percentage = (this.value / this.max) * 100;
      innerBar.style.width = `${percentage}%`;
    }
    if (this.config.showLabel) {
      this.updatePercentageLabel();
    }
  }
  private updatePercentageLabel(): void {
    const percentage = Math.round((this.value / this.max) * 100);
    if (!this.labelElement) {
      this.labelElement = document.createElement('span');
      this.labelElement.className = 'web-progress__label';
      this.labelElement.style.cssText = 'font-size: 12px; color: #666; margin-left: 8px;';
      this.element.appendChild(this.labelElement);
    }
    this.labelElement.textContent = `${percentage}%`;
  }
  render(): void {
    this.updateBar();
  }
  destroy(): void {
    this.element.remove();
  }
  increment(amount?: number): void { /* TODO */ }
  getPercentage(): number { return 0; }
}
