/**
 * 终端按钮组件
 * @description 实现 IButton 接口，支持点击回调
 * @module presentation/adapters/cli/components/Button
 */
import type { IButton, IButtonConfig } from '../../../core/interfaces';
/**
 * 终端按钮组件
 * 按钮点击通过 trigger() 方法触发
 */
export class TerminalButton implements IButton {
  private text = '';
  private clickCallback?: () => void;
  private disabled = false;
  private loading = false;
  setText(text: string): void {
    this.text = text;
  }
  setConfig(_config: IButtonConfig): void {
    // unused in terminal
  }
  onClick(callback: () => void): void {
    this.clickCallback = callback;
  }
  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
  }
  setLoading(loading: boolean): void {
    this.loading = loading;
  }
  /**
   * 执行按钮动作
   */
  trigger(): void {
    if (!this.disabled && !this.loading) {
      this.clickCallback?.();
    }
  }
  render(): void {
    if (this.text) {
      const indicator = this.loading ? '⏳' : this.disabled ? '🚫' : '';
      console.log(`  [${indicator}${this.text}]`);
    }
  }
  destroy(): void {
    this.text = '';
    // Note: callback intentionally not cleared to avoid exactOptionalPropertyTypes issue
  }
}
