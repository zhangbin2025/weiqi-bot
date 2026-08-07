/**
 * Web Panel 组件
 * @description 带卡片样式的容器 <div>，可包含子组件
 */
import type { IPanel, IPanelChild } from '../../../core/interfaces';
export class WebPanel implements IPanel {
  private element: HTMLElement;
  private titleElement?: HTMLElement;
  private actionCallback?: (action: string, data?: Record<string, string>) => void;
  private children: IPanelChild[] = [];
  private visible = true;
  private mounted = false;
  constructor(container?: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'web-panel';
    this.element.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.1);
    `;
    if (container) {
      container.appendChild(this.element);
      this.mounted = true;
    }
  }
  setTitle(title: string): void {
    if (!this.titleElement) {
      this.titleElement = document.createElement('h2');
      this.titleElement.style.cssText = `
        font-size: 1.1em;
        margin-bottom: 12px;
        color: #333;
        display: flex;
        align-items: center;
        gap: 8px;
      `;
      this.element.insertBefore(this.titleElement, this.element.firstChild);
    }
    this.titleElement.innerHTML = title;
  }
  add(child: IPanelChild): void {
    this.children.push(child);
  }
  onAction(callback: (action: string, data?: Record<string, string>) => void): void {
    this.actionCallback = callback;
    // 事件委托：在 element 上统一监听所有 [data-action] 点击
    this.element.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]');
      if (!target) return;
      e.stopPropagation();
      const action = (target as HTMLElement).dataset['action'] ?? '';
      const data: Record<string, string> = {};
      for (const [k, v] of Object.entries((target as HTMLElement).dataset)) {
        if (k !== 'action') data[k] = v ?? '';
      }
      this.actionCallback?.(action, data);
    });
  }
  addAction(label: string, action: string): void {
    if (!this.titleElement) return;
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.dataset['action'] = action;
    btn.style.cssText = 'width:auto;padding:4px 8px;font-size:0.85em;margin-left:auto;background:#f0f0f0;border:none;color:#666;cursor:pointer;border-radius:8px;';
    btn.className = 'icon-btn';
    this.titleElement.appendChild(btn);
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.element.style.display = visible ? '' : 'none';
  }
  isVisible(): boolean {
    return this.visible;
  }
  asContainer(): unknown {
    return this.element;
  }
  render(): void {
    if (!this.mounted && document.body && !document.body.contains(this.element)) {
      document.body.appendChild(this.element);
      this.mounted = true;
    }
    for (const child of this.children) {
      child.render();
    }
  }
  destroy(): void {
    for (const child of this.children) {
      child.destroy();
    }
    this.children = [];
    this.element.remove();
  }
}
