/**
 * Web Dialog 组件
 */
import type { IDialog, IDialogConfig, DialogResult } from '../../../core/interfaces';
export class WebDialog implements IDialog {
  private overlay: HTMLElement;
  private dialog: HTMLElement;
  private contentContainer: HTMLElement;
  private resolvePromise?: ((value: boolean | string | null) => void) | undefined;
  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'web-dialog-overlay';
    this.overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.5); display: none;
      justify-content: center; align-items: center; z-index: 1000;
    `;
    this.dialog = document.createElement('div');
    this.dialog.className = 'web-dialog';
    this.dialog.style.cssText = `
      background: white; padding: 20px; border-radius: 8px;
      min-width: 300px; max-width: 500px;
    `;
    this.contentContainer = document.createElement('div');
    this.contentContainer.className = 'web-dialog__content';
    this.overlay.appendChild(this.dialog);
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
  }
  async show(config: IDialogConfig): Promise<DialogResult> {
    const {
      title,
      content,
      type = 'alert',
// placeholder removed - not in IDialogConfig
      confirmText = '确定',
      cancelText = '取消'
    } = config;
    this.dialog.innerHTML = '';
    if (title) {
      const titleEl = document.createElement('h3');
      titleEl.textContent = title;
      titleEl.style.cssText = 'margin: 0 0 16px 0; font-size: 18px;';
      this.dialog.appendChild(titleEl);
    }
    this.contentContainer.innerHTML = '';
    if (content) {
      this.contentContainer.innerHTML = content;
    }
    this.dialog.appendChild(this.contentContainer);
    let inputEl: HTMLInputElement | null = null;
    if (type === 'prompt') {
      inputEl = document.createElement('input');
      inputEl.type = 'text';
      inputEl.placeholder = '';
      inputEl.style.cssText = 'width: 100%; padding: 8px; margin-top: 12px; box-sizing: border-box;';
      this.dialog.appendChild(inputEl);
    }
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'margin-top: 20px; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;';
    if (type !== 'alert') {
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = cancelText;
      cancelBtn.style.cssText = `
        padding: 12px 24px;
        min-width: 100px;
        border: none;
        border-radius: 8px;
        background: #f0f0f0;
        color: #333;
        font-size: 16px;
        cursor: pointer;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      `;
      cancelBtn.onmouseover = () => cancelBtn.style.background = '#e0e0e0';
      cancelBtn.onmouseout = () => cancelBtn.style.background = '#f0f0f0';
      cancelBtn.onclick = () => this.close();
      buttonContainer.appendChild(cancelBtn);
    }
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = confirmText;
    confirmBtn.style.cssText = `
      padding: 12px 24px;
      min-width: 100px;
      border: none;
      border-radius: 8px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      font-size: 16px;
      cursor: pointer;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    `;
    confirmBtn.onmouseover = () => confirmBtn.style.opacity = '0.9';
    confirmBtn.onmouseout = () => confirmBtn.style.opacity = '1';
    confirmBtn.onclick = () => {
      if (type === 'prompt' && inputEl) {
        this.resolvePromise?.(inputEl.value);
      } else {
        this.resolvePromise?.(true);
      }
      this.close();
    };
    buttonContainer.appendChild(confirmBtn);
    this.dialog.appendChild(buttonContainer);
    this.overlay.style.display = 'flex';
    document.body.appendChild(this.overlay);
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
    });
  }
  close(): void {
    this.overlay.style.display = 'none';
    this.resolvePromise?.(null);
    this.resolvePromise = undefined;
  }
  setContent(content: string): void {
    this.contentContainer.innerHTML = '';
    this.contentContainer.innerHTML = content;
  }
  destroy(): void {
    this.overlay.remove();
  }
}
