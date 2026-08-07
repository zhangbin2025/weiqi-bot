/**
 * 终端对话框组件（No-op 实现）
 * @description PlayerPage 持有 dialog 但当前不使用，终端下返回空实现
 * @module presentation/adapters/cli/components/Dialog
 */
import type { IDialog, IDialogConfig, DialogResult } from '../../../core/interfaces';
export class TerminalDialog implements IDialog {
  async show(_config: IDialogConfig): Promise<DialogResult> {
    return true;
  }
  close(): void {
    // no-op
  }
  setContent(_content: string): void {
    // no-op
  }
  destroy(): void {
    // no-op
  }
}
