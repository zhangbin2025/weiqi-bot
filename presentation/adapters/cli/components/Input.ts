/**
 * 终端输入组件
 * @description 实现 IInput 接口，通过 readline 读取用户输入
 * @module presentation/adapters/cli/components/Input
 */
import type { IInput, IInputConfig, InputState } from '../../../core/interfaces';
import * as readline from 'readline';
/**
 * 终端输入组件
 * 通过 readline 模块读取用户输入
 */
export class TerminalInput implements IInput {
  private value = '';
  private enterCallback?: (value: string) => void;
  private changeCallback?: (value: string) => void;
  private placeholder = '';
  private disabled = false;
  setConfig(config: IInputConfig): void {
    this.placeholder = config.placeholder ?? '';
    if (config.value !== undefined) {
      this.value = config.value;
    }
    if (config.disabled !== undefined) {
      this.disabled = config.disabled;
    }
  }
  getValue(): string {
    return this.value;
  }
  setValue(value: string): void {
    this.value = value;
    this.changeCallback?.(value);
  }
  clear(): void {
    this.value = '';
    this.changeCallback?.('');
  }
  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
  }
  setState(_state: InputState): void {
    // unused in terminal
  }
  focus(): void {
    // terminal input is triggered by readLine
  }
  blur(): void {
    // terminal input is triggered by readLine
  }
  onChange(callback: (value: string) => void): void {
    this.changeCallback = callback;
  }
  onEnter(callback: (value: string) => void): void {
    this.enterCallback = callback;
  }
  async pasteFromClipboard(): Promise<boolean> {
    // terminal doesn't support clipboard
    return false;
  }
  /**
   * 阻塞读取用户输入
   */
  async readLine(): Promise<string> {
    if (this.disabled) {
      return '';
    }
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise((resolve) => {
      const prompt = this.placeholder ? `${this.placeholder} ` : '';
      rl.question(`> ${prompt}`, (answer) => {
        rl.close();
        const trimmed = answer.trim();
        if (trimmed) {
          this.value = trimmed;
          this.changeCallback?.(trimmed);
          this.enterCallback?.(trimmed);
        }
        resolve(trimmed);
      });
    });
  }
  render(): void {
    // terminal input is triggered by readLine
  }
  destroy(): void {
    this.value = '';
    // Note: callbacks intentionally not cleared to avoid exactOptionalPropertyTypes issue
  }
}
