/**
 * Web 选择器组件
 * @module presentation/adapters/web/components/Select
 */
import type { ISelect, ISelectConfig, ISelectOption } from '../../../core/interfaces';
import { Select as UISelect, type SelectInstance, type SelectOption } from '@ui';
/**
 * Web 选择器实现（基于自绘 Select 组件）
 */
export class WebSelect implements ISelect {
  private options: ISelectOption[] = [];
  private value?: string | undefined;
  private config: ISelectConfig = {};
  private changeCallback?: ((value: string) => void) | undefined;
  private container: HTMLDivElement;
  private instance: SelectInstance | null = null;
  private mounted = false;
  private unsubscribe?: (() => void) | undefined;
  private transparentStyleEl?: HTMLStyleElement | undefined;
  constructor(container?: HTMLElement) {
    this.container = document.createElement('div');
    this.container.style.cssText = 'margin-bottom: 12px;';
    if (container) {
      container.appendChild(this.container);
      this.mounted = true;
    }
    // 立即创建 UISelect 实例，确保兼容原有代码
    this.instance = UISelect.mount(this.container, {
      options: this.options as SelectOption[],
      ...(this.value !== undefined ? { value: this.value } : {}),
      ...(this.config.placeholder !== undefined ? { placeholder: this.config.placeholder } : {}),
      ...(this.config.disabled !== undefined ? { disabled: this.config.disabled } : {}),
      onChange: (v: string) => {
        this.value = v;
        this.changeCallback?.(v);
      },
    });
  }
  setOptions(options: ISelectOption[]): void {
    this.options = options;
    if (this.instance) {
      this.instance.setOptions(options as SelectOption[]);
    }
  }
  setValue(value: string): void {
    this.value = value;
    if (this.instance) {
      this.instance.setValue(value, true);
    }
  }
  getValue(): string | undefined {
    return this.instance?.getValue() ?? this.value;
  }
  setConfig(config: ISelectConfig): void {
    this.config = config;
    if (config.options) {
      this.options = config.options;
    }
    if (config.value !== undefined) {
      this.value = config.value;
    }
    // 如果实例已存在，更新配置
    if (this.instance) {
      if (config.options) this.instance.setOptions(config.options as SelectOption[]);
      if (config.value !== undefined) this.instance.setValue(config.value, true);
      if (config.disabled !== undefined) this.instance.setDisabled(config.disabled);
    }
  }
  onChange(callback: (value: string) => void): void {
    this.changeCallback = callback;
    if (this.instance) {
      // 先取消之前的订阅
      this.unsubscribe?.();
      // 注册新订阅并保存取消函数
      this.unsubscribe = this.instance.onChange((v) => callback(v));
    }
  }
  render(): void {
    if (!this.mounted && document.body && !document.body.contains(this.container)) {
      document.body.appendChild(this.container);
      this.mounted = true;
    }
    // 实例已在构造函数中创建，无需再创建
  }
  mountTo(container: unknown): void {
    const el = container as HTMLElement;
    const slot = el.querySelector('[data-slot="group-select"]');
    if (slot) {
      this.container.style.marginBottom = '0';
      slot.appendChild(this.container);
      this.mounted = true;
      // 实例已在构造函数中创建，无需再创建
    }
  }
  setTransparentStyle(): void {
    // 防止重复添加
    if (this.transparentStyleEl) return;
    // 为深色背景添加透明样式覆盖
    this.container.classList.add('ui-select--transparent');
    // 添加内联样式覆盖
    this.transparentStyleEl = document.createElement('style');
    this.transparentStyleEl.textContent = `
      .ui-select--transparent .ui-select__trigger {
        background: rgba(255,255,255,0.15);
        border-color: rgba(255,255,255,0.3);
        color: white;
      }
      .ui-select--transparent .ui-select__label {
        color: white;
      }
      .ui-select--transparent .ui-select__arrow {
        border-color: white;
      }
    `;
    this.container.appendChild(this.transparentStyleEl);
  }
  destroy(): void {
    this.unsubscribe?.();
    this.instance?.destroy();
    this.container.remove();
    this.options = [];
    this.value = undefined;
    this.changeCallback = undefined;
    this.instance = null;
    this.unsubscribe = undefined;
    this.transparentStyleEl = undefined;
  }
}
