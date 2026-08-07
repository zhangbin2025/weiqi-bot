/**
 * Web Input 组件
 * @description 支持 text/password/number/email/search/textarea 类型
 *              textarea: Shift+Enter 换行，Enter 触发 onEnter
 */
import type { IInput, IInputConfig, InputState, InputType } from '../../../core/interfaces';
import { WebClipboard } from '../../../../infrastructure/utils/clipboard';
export class WebInput implements IInput {
  private element: HTMLInputElement | HTMLTextAreaElement;
  private container?: HTMLDivElement;
  private focusCallback?: () => void;
  private changeCallback?: (value: string) => void;
  private enterCallback?: (value: string) => void;
  private config: IInputConfig = {};
  private clipboard: WebClipboard;
  private state: InputState = 'default';
  private mounted = false;
  private _type: InputType = 'text';
  constructor(container?: HTMLElement) {
    this.clipboard = new WebClipboard();
    this.container = document.createElement('div');
    this.container.style.cssText = `margin-bottom: 0;`;
    // 默认创建 input
    this.element = document.createElement('input');
    this.element.className = 'web-input';
    this.element.type = 'text';
    this.applyDefaultStyles();
    this.setupEvents();
    this.container.appendChild(this.element);
    if (container) {
      container.appendChild(this.container);
      this.mounted = true;
    }
  }
  /** 应用默认样式 */
  private applyDefaultStyles(): void {
    const baseStyles = `
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 16px;
      transition: border-color 0.3s;
      outline: none;
      box-sizing: border-box;
      background: white;
      color: #333;
      font-family: inherit;
    `;
    if (this._type === 'textarea') {
      this.element.style.cssText = baseStyles + `
        resize: vertical;
        min-height: 80px;
        line-height: 1.5;
      `;
    } else {
      this.element.style.cssText = baseStyles;
    }
  }
  /** 设置事件监听 */
  private setupEvents(): void {
    this.element.addEventListener('focus', () => {
      this.element.style.borderColor = '#667eea';
      this.focusCallback?.();
    });
    this.element.addEventListener('blur', () => {
      this.element.style.borderColor = '#e0e0e0';
    });
    this.element.addEventListener('input', () => {
      this.changeCallback?.(this.element.value);
    });
    // 键盘事件：textarea 特殊处理
    this.element.addEventListener('keydown', ((e: Event) => {
      const ke = e as KeyboardEvent;
      // Ctrl+V / Cmd+V 粘贴：不阻止默认行为
      if ((ke.ctrlKey || ke.metaKey) && ke.key === 'v') {
        return;
      }
      if (ke.key === 'Enter') {
        if (this._type === 'textarea') {
          // textarea: Shift+Enter 换行，Enter 触发 onEnter
          if (!ke.shiftKey) {
            ke.preventDefault();
            this.enterCallback?.(this.element.value);
          }
        } else {
          // input: Enter 直接触发 onEnter
          this.enterCallback?.(this.element.value);
        }
      }
    }) as EventListener);
    // 右键菜单粘贴支持
    this.element.addEventListener('contextmenu', (e) => {
      // 允许默认右键菜单（包含粘贴选项）
    });
  }
  /** 切换元素类型（input ↔ textarea） */
  private switchElementType(newType: InputType): void {
    if (newType === this._type) return;
    const oldValue = this.element.value;
    // 移除旧元素
    this.element.remove();
    // 创建新元素
    this._type = newType;
    if (newType === 'textarea') {
      this.element = document.createElement('textarea');
      this.element.className = 'web-input textarea';
      this.element.setAttribute('spellcheck', 'false');
      this.element.setAttribute('autocomplete', 'off');
      this.element.setAttribute('autocapitalize', 'off');
    } else {
      this.element = document.createElement('input');
      this.element.className = 'web-input';
      this.element.type = newType;
    }
    // 恢复值和样式
    this.element.value = oldValue;
    this.applyDefaultStyles();
    // 重新设置事件
    this.setupEvents();
    // 添加到容器
    this.container?.appendChild(this.element);
  }
  setValue(value: string): void { this.element.value = value; }
  getValue(): string { return this.element.value; }
  /**
   * 获取容器元素（供外部布局使用）
   */
  getContainer(): HTMLElement | undefined {
    return this.container;
  }
  setPlaceholder(text: string): void { this.element.placeholder = text; }
  setDisabled(disabled: boolean): void {
    this.element.disabled = disabled;
    this.element.style.backgroundColor = disabled ? '#f5f5f5' : 'white';
  }
  setConfig(config: IInputConfig): void {
    this.config = config;
    // 类型切换
    if (config.type && config.type !== this._type) {
      this.switchElementType(config.type);
    }
    // 其他配置
    if (config.placeholder) this.element.placeholder = config.placeholder;
    if (config.value) this.element.value = config.value;
    if (config.disabled !== undefined) this.setDisabled(config.disabled);
    if (config.readonly !== undefined) this.element.readOnly = config.readonly;
    if (config.required !== undefined) this.element.required = config.required;
    // input 类型特有属性
    if (this._type !== 'textarea') {
      const inputEl = this.element as HTMLInputElement;
      if (config.maxLength !== undefined) inputEl.maxLength = config.maxLength;
      if (config.minLength !== undefined) inputEl.minLength = config.minLength;
      if (config.min !== undefined) inputEl.min = String(config.min);
      if (config.max !== undefined) inputEl.max = String(config.max);
    }
    if (config.state !== undefined) this.setState(config.state);
  }
  onFocus(callback: () => void): void { this.focusCallback = callback; }
  onChange(callback: (value: string) => void): void { this.changeCallback = callback; }
  onEnter(callback: (value: string) => void): void { this.enterCallback = callback; }
  async pasteFromClipboard(): Promise<boolean> {
    const text = await this.clipboard.readText();
    if (text) {
      this.element.value = text;
      this.changeCallback?.(text);
      return true;
    }
    return false;
  }
  clear(): void {
    this.element.value = '';
    this.changeCallback?.('');
  }
  setState(state: InputState): void {
    this.state = state;
    const colors: Record<InputState, string> = {
      default: '#e0e0e0',
      success: '#52c41a',
      warning: '#faad14',
      error: '#ff4d4f',
    };
    this.element.style.borderColor = colors[state];
  }
  focus(): void { this.element.focus(); }
  blur(): void { this.element.blur(); }
  render(): void {
    if (!this.mounted && document.body && this.container && !document.body.contains(this.container)) {
      document.body.appendChild(this.container);
      this.mounted = true;
    }
  }
  destroy(): void { this.container?.remove(); }
}