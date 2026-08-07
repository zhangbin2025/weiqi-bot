/**
 * 终端面板组件
 * @description 实现 IPanel 接口，管理子组件的渲染
 * @module presentation/adapters/cli/components/Panel
 */
import type { IPanel, IPanelChild } from '../../../core/interfaces';
/**
 * 终端面板组件
 * 管理子组件的渲染，setVisible 控制输出
 */
export class TerminalPanel implements IPanel {
  private titleText = '';
  private children: IPanelChild[] = [];
  private visible = true;
  private actionCb?: (action: string, data?: Record<string, string>) => void;
  setTitle(title: string): void {
    this.titleText = title;
  }
  add(child: IPanelChild): void {
    this.children.push(child);
  }
  setVisible(visible: boolean): void {
    this.visible = visible;
  }
  isVisible(): boolean {
    return this.visible;
  }
  asContainer(): unknown {
    // terminal 不需要容器
    return null;
  }
  onAction(callback: (action: string, data?: Record<string, string>) => void): void {
    this.actionCb = callback;
  }
  /**
   * 触发动作
   */
  triggerAction(action: string, data?: Record<string, string>): void {
    this.actionCb?.(action, data);
  }
  render(): void {
    if (!this.visible) {
      return;
    }
    if (this.titleText) {
      console.log(`\n\x1b[1m${this.titleText}\x1b[0m`);
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
    this.titleText = '';
    // Note: callback intentionally not cleared to avoid exactOptionalPropertyTypes issue
  }
}
