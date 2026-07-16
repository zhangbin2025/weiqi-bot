/**
 * 遮罩层接口
 * @module presentation/core/interfaces/IOverlay
 *
 * 用于全屏遮罩场景（加载进度、模态背景等），
 * 语义独立于 ICard，避免复用 Card 的 fixed 定位 hack。
 */
export interface IOverlay {
  /** 显示遮罩 */
  show(): void;
  /** 隐藏遮罩 */
  hide(): void;
  /** 设置内容（HTML 字符串，由 formatter 产出） */
  setContent(content: string): void;
  /** 设置进度条 */
  setProgress(percent: number, message: string): void;
  /** 渲染（挂载到 DOM，幂等） */
  render(): void;
  /** 销毁并移除 DOM */
  destroy(): void;
}
