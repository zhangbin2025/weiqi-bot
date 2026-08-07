/**
 * 适配器工厂接口
 * @module presentation/core/interfaces/IAdapterFactory
 *
 * 定义创建 UI 组件的抽象工厂。
 * Web 环境注入 WebAdapterFactory，CLI 环境注入 TerminalAdapterFactory。
 * Page 层只依赖此接口，不绑定任何平台。
 */
import type {
  IBoard,
  IButton,
  INotification,
  IDialog,
  IProgress,
  IToast,
  ITabs,
  ICard,
  IInput,
  ISelect,
  IList,
  IPanel,
  IOverlay,
} from './index';
export interface IAdapterFactory {
  /** 设置全局根容器（组件 auto-mount 目标） */
  setRootContainer(container: unknown): void;
  createBoard(): IBoard;
  createButton(container?: unknown): IButton;
  createNotification(): INotification;
  createDialog(): IDialog;
  createProgress(): IProgress;
  createToast(): IToast;
  createTabs(container?: unknown): ITabs;
  createCard(container?: unknown): ICard;
  createInput(container?: unknown): IInput;
  createSelect(container?: unknown): ISelect;
  createList(): IList;
  createPanel(container?: unknown): IPanel;
  createOverlay(): IOverlay;
}
