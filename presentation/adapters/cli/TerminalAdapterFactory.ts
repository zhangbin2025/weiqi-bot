/**
 * 终端适配器工厂
 * @description 实现 IAdapterFactory 接口，创建终端环境的 UI 组件
 * @module presentation/adapters/cli/TerminalAdapterFactory
 */
import type { IAdapterFactory } from '../../core/interfaces';
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
} from '../../core/interfaces';
import {
  TerminalCard,
  TerminalInput,
  TerminalTabs,
  TerminalPanel,
  TerminalButton,
  TerminalToast,
  TerminalDialog,
} from './components';
/**
 * 终端适配器工厂
 * 创建适用于 CLI 环境的 UI 组件
 */
export class TerminalAdapterFactory implements IAdapterFactory {
  setRootContainer(_container: unknown): void {
    // terminal 不需要根容器
  }
  createBoard(): IBoard {
    throw new Error('Board not supported in terminal');
  }
  createButton(_container?: unknown): IButton {
    return new TerminalButton();
  }
  createNotification(): INotification {
    throw new Error('Notification not supported in terminal');
  }
  createDialog(_container?: unknown): IDialog {
    return new TerminalDialog();
  }
  createProgress(): IProgress {
    throw new Error('Progress not supported in terminal');
  }
  createToast(): IToast {
    return new TerminalToast();
  }
  createTabs(_container?: unknown): ITabs {
    return new TerminalTabs();
  }
  createCard(_container?: unknown): ICard {
    return new TerminalCard();
  }
  createInput(_container?: unknown): IInput {
    return new TerminalInput();
  }
  createSelect(): ISelect {
    throw new Error('Select not supported in terminal');
  }
  createList(): IList {
    throw new Error('List not supported in terminal');
  }
  createPanel(_container?: unknown): IPanel {
    return new TerminalPanel();
  }
  createOverlay(): IOverlay {
    throw new Error('Overlay not supported in terminal');
  }
}
