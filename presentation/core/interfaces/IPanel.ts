/**
 * 面板接口
 * @module presentation/core/interfaces/IPanel
 *
 * 面板是容器组件，用于组合和分组其他组件。
 * Web: 一个带样式的 <div>，setVisible 控制 display
 * Terminal: 一个 blessed box
 * CLI: 无视觉容器，setVisible 切换输出逻辑
 */
/** 可添加到面板的子组件标记 */
export interface IPanelChild {
  render(): void;
  destroy(): void;
}
/** 面板接口 */
export interface IPanel {
  /** 设置标题 */
  setTitle(title: string): void;
  /** 添加子组件 */
  add(child: IPanelChild): void;
  /** 设置动作事件（面板内容区的交互，如清除按钮） */
  onAction(callback: (action: string, data?: Record<string, string>) => void): void;
  /** 显示/隐藏面板 */
  setVisible(visible: boolean): void;
  /** 是否可见 */
  isVisible(): boolean;
  /** 添加标题栏动作按钮 */
  addAction?(label: string, action: string): void;
  /** 获取平台容器（用于子组件挂载） */
  asContainer(): unknown;
  /** 渲染 */
  render(): void;
  /** 销毁 */
  destroy(): void;
}
