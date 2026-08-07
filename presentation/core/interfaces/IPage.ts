/**
 * 页面接口
 * @module presentation/core/interfaces/IPage
 */
/**
 * 页面参数
 */
export type PageParams = Record<string, string>;
/**
 * 页面配置
 */
export interface IPageConfig {
  title?: string;
  requiresAuth?: boolean;
  keepAlive?: boolean;
}
/**
 * 页面接口
 * 定义页面控制器的抽象接口
 */
export interface IPage {
  /** 页面标题 */
  readonly title: string;
  /** 初始化 */
  initialize(): Promise<void>;
  /** 渲染 */
  render(): void;
  /** 激活（页面显示时） */
  onActivate?(): void;
  /** 停用（页面隐藏时） */
  onDeactivate?(): void;
  /** 处理 URL 参数 */
  handleParams(params: PageParams): void | Promise<void>;
  /** 销毁 */
  destroy(): void;
}
