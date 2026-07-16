/**
 * Dialog - 公共对话框组件
 *
 * 替代浏览器原生 alert / confirm，提供与 play/styles 中
 * .dialog-overlay/.dialog 相同的视觉风格。
 *
 * 用法：
 *   await Dialog.alert('无棋谱数据');
 *   const ok = await Dialog.confirm('确定要清空吗？');
 *   const ok = await Dialog.confirm('删除？', { title: '危险操作', confirmText: '删除', danger: true });
 */

export interface DialogBaseOptions {
  /** 标题，默认 alert='提示', confirm='确认' */
  title?: string;
}

export interface AlertOptions extends DialogBaseOptions {
  /** 确认按钮文案，默认"知道了" */
  okText?: string;
}

export interface ConfirmOptions extends DialogBaseOptions {
  /** 确认按钮文案，默认"确定" */
  confirmText?: string;
  /** 取消按钮文案，默认"取消" */
  cancelText?: string;
  /** 是否危险操作（暂时只影响语义，保留扩展空间） */
  danger?: boolean;
}

/** 内部：创建 overlay 节点并挂到 body */
function buildOverlay(): { overlay: HTMLDivElement; dialog: HTMLDivElement } {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  overlay.appendChild(dialog);
  return { overlay, dialog };
}

/** 内部：把 overlay 挂载并触发显示动画 */
function show(overlay: HTMLDivElement): void {
  document.body.appendChild(overlay);
  // 强制 reflow 后再加 .show，确保动画播放
  void overlay.offsetWidth;
  overlay.classList.add('show');
}

/** 内部：关闭并清理 */
function dismiss(overlay: HTMLDivElement, cleanup?: () => void): void {
  overlay.classList.remove('show');
  // 简单移除（CSS 动画极短，不必等过渡）
  if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  cleanup?.();
}

export const Dialog = {
  /** 提示框（仅一个确认按钮） */
  alert(message: string, opts: AlertOptions = {}): Promise<void> {
    return new Promise<void>((resolve) => {
      const { overlay, dialog } = buildOverlay();
      const title = opts.title ?? '提示';
      const okText = opts.okText ?? '知道了';

      dialog.innerHTML = `
        <div class="dialog-title"></div>
        <div class="dialog-message"></div>
        <div class="dialog-btn-group">
          <button class="dialog-btn primary" data-act="ok"></button>
        </div>
      `;
      (dialog.querySelector('.dialog-title') as HTMLElement).textContent = title;
      (dialog.querySelector('.dialog-message') as HTMLElement).textContent = message;
      const okBtn = dialog.querySelector('[data-act="ok"]') as HTMLButtonElement;
      okBtn.textContent = okText;

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          close();
        }
      };
      const close = () => {
        okBtn.removeEventListener('click', close);
        document.removeEventListener('keydown', onKey);
        dismiss(overlay);
        resolve();
      };

      okBtn.addEventListener('click', close);
      document.addEventListener('keydown', onKey);
      show(overlay);
      okBtn.focus();
    });
  },

  /** 确认框（确定/取消两个按钮） */
  confirm(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const { overlay, dialog } = buildOverlay();
      const title = opts.title ?? '确认';
      const confirmText = opts.confirmText ?? '确定';
      const cancelText = opts.cancelText ?? '取消';

      dialog.innerHTML = `
        <div class="dialog-title"></div>
        <div class="dialog-message"></div>
        <div class="dialog-btn-group">
          <button class="dialog-btn secondary" data-act="cancel"></button>
          <button class="dialog-btn primary" data-act="ok"></button>
        </div>
      `;
      (dialog.querySelector('.dialog-title') as HTMLElement).textContent = title;
      (dialog.querySelector('.dialog-message') as HTMLElement).textContent = message;
      const okBtn = dialog.querySelector('[data-act="ok"]') as HTMLButtonElement;
      const cancelBtn = dialog.querySelector('[data-act="cancel"]') as HTMLButtonElement;
      okBtn.textContent = confirmText;
      cancelBtn.textContent = cancelText;

      const finish = (result: boolean) => {
        okBtn.removeEventListener('click', okHandler);
        cancelBtn.removeEventListener('click', cancelHandler);
        overlay.removeEventListener('click', overlayHandler);
        document.removeEventListener('keydown', onKey);
        dismiss(overlay);
        resolve(result);
      };
      const okHandler = () => finish(true);
      const cancelHandler = () => finish(false);
      const overlayHandler = (e: MouseEvent) => {
        if (e.target === overlay) finish(false);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        else if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      };

      okBtn.addEventListener('click', okHandler);
      cancelBtn.addEventListener('click', cancelHandler);
      overlay.addEventListener('click', overlayHandler);
      document.addEventListener('keydown', onKey);
      show(overlay);
      okBtn.focus();
    });
  },
};

export default Dialog;
