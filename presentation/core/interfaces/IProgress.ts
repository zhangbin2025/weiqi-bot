/**
 * 进度条接口
 * @module presentation/core/interfaces/IProgress
 */
/**
 * 进度条配置
 */
export interface IProgressConfig {
  value?: number;
  max?: number;
  showLabel?: boolean;
  striped?: boolean;
  animated?: boolean;
  variant?: 'default' | 'success' | 'warning' | 'error';
  size?: 'sm' | 'md' | 'lg';
}
/**
 * 进度条接口
 * 定义进度条组件的抽象接口
 */
export interface IProgress {
  /** 设置值 */
  setValue(value: number): void;
  /** 设置最大值 */
  setMax(max: number): void;
  /** 设置配置 */
  setConfig(config: IProgressConfig): void;
  /** 增加进度 */
  increment(amount?: number): void;
  /** 获取百分比 */
  getPercentage(): number;
  /** 显示 */
  show(): void;
  /** 隐藏 */
  hide(): void;
  /** 渲染 */
  render(): void;
  /** 销毁 */
  destroy(): void;
}
