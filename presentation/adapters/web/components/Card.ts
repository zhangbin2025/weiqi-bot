/**
 * Web Card 组件
 */
import type { ICard, ICardConfig } from '../../../core/interfaces';
export class WebCard implements ICard {
  private element: HTMLElement;
  private headerElement?: HTMLElement;
  private bodyElement: HTMLElement;
  private actionCallback?: (action: string, data?: Record<string, string>) => void;
  private mounted = false;
  private container: HTMLElement | undefined;
  constructor(container?: HTMLElement) {
    this.container = container;
    this.element = document.createElement('div');
    this.element.className = 'web-card';
    this.element.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.1);
    `;
    this.bodyElement = document.createElement('div');
    this.bodyElement.className = 'web-card__body';
    this.bodyElement.style.cssText = `
      font-size: 14px;
      line-height: 1.6;
      color: #333;
    `;
    this.element.appendChild(this.bodyElement);
    if (container) {
      container.appendChild(this.element);
      this.mounted = true;
    }
  }
  setContent(content: string): void {
    this.bodyElement.innerHTML = content;
  }
  appendChild(child: HTMLElement): void {
    this.bodyElement.appendChild(child);
  }
  setTitle(title: string): void {
    if (!this.headerElement) {
      this.headerElement = document.createElement('div');
      this.headerElement.className = 'web-card__header';
      this.headerElement.style.cssText = `
        font-size: 1.1em;
        font-weight: 600;
        margin-bottom: 12px;
        color: #333;
        display: flex;
        align-items: center;
        gap: 8px;
      `;
      this.element.insertBefore(this.headerElement, this.bodyElement);
    }
    this.headerElement.innerHTML = title;
  }
  setSubtitle(subtitle: string): void { /* TODO */ }
  setConfig(config: ICardConfig): void {
    if (config.padding === 'none') {
      this.element.style.padding = '0';
    } else if (config.padding === 'sm') {
      this.element.style.padding = '8px';
    }
    if (config.elevation === 'none') {
      this.element.style.boxShadow = 'none';
      this.element.style.background = 'transparent';
    }
    if (config.position === 'fixed') {
      this.element.style.position = 'fixed';
      this.element.style.top = '0';
      this.element.style.left = '0';
      this.element.style.width = '100%';
      this.element.style.height = '100%';
      this.element.style.zIndex = '9999';
    }
    if (config.fullScreen) {
      this.element.style.width = '100%';
      this.element.style.height = '100%';
    }
  }
  onClick(callback: () => void): void { this.element.addEventListener('click', callback); }
  onAction(callback: (action: string, data?: Record<string, string>) => void): void {
    this.actionCallback = callback;
    // 拦截 bodyElement 内的 [data-action] 点击事件
    this.bodyElement.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]');
      if (!target) return;
      const action = (target as HTMLElement).dataset['action'] ?? '';
      const data: Record<string, string> = {};
      for (const [k, v] of Object.entries((target as HTMLElement).dataset)) {
        if (k !== 'action') data[k] = v ?? '';
      }
      this.actionCallback?.(action, data);
    });
  }
  addClass(className: string): void { this.element.classList.add(className); }
  setVisible(visible: boolean): void {
    this.element.style.display = visible ? '' : 'none';
  }
  render(): void {
    if (!this.mounted) {
      const target = this.container ?? document.getElementById('page-root') ?? document.body;
      if (!target.contains(this.element)) {
        target.appendChild(this.element);
      }
      this.mounted = true;
    }
  }
  getContainer(): unknown {
    return this.bodyElement;
  }
  ensureBefore(target: ICard): void {
    const targetEl = (target as unknown as { element?: HTMLElement }).element;
    if (targetEl && this.element && this.element.nextSibling !== targetEl) {
      targetEl.parentNode?.insertBefore(this.element, targetEl);
    }
  }
  destroy(): void { this.element.remove(); }
}
