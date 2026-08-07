/**
 * Web 适配器工厂
 * @module presentation/adapters/web/WebAdapterFactory
 *
 * 创建 Web/Electron 平台的 UI 组件实现。
 */
import type { IAdapterFactory } from '../../core/interfaces';
import type {
  IBoard, IButton, INotification, IDialog, IProgress,
  IToast, ITabs, ICard, IInput, ISelect, IList, IPanel,
  IOverlay,
} from '../../core/interfaces';
import { WebBoard } from './components/Board';
import { WebButton } from './components/Button';
import { WebCard } from './components/Card';
import { WebDialog } from './components/Dialog';
import { WebInput } from './components/Input';
import { WebList } from './components/List';
import { WebNotification } from './components/Notification';
import { WebPanel } from './components/Panel';
import { WebProgress } from './components/Progress';
import { WebSelect } from './components/Select';
import { WebTabs } from './components/Tabs';
import { WebToast } from './components/Toast';
import { WebOverlay } from './components/Overlay';
export class WebAdapterFactory implements IAdapterFactory {
  private rootContainer: unknown = null;
  setRootContainer(container: unknown): void {
    this.rootContainer = container;
  }
  /** 解析容器：优先用传入的，否则用全局根容器 */
  private resolveContainer(override?: unknown): HTMLElement | undefined {
    if (override instanceof HTMLElement) return override;
    return this.rootContainer instanceof HTMLElement
      ? this.rootContainer
      : undefined;
  }
  createBoard(): IBoard { return new WebBoard(this.resolveContainer()); }
  createButton(container?: unknown): IButton {
    return new WebButton(this.resolveContainer(container)) as unknown as IButton;
  }
  createNotification(): INotification {
    return new WebNotification() as unknown as INotification;
  }
  createDialog(): IDialog { return new WebDialog(); }
  createProgress(): IProgress {
    return new WebProgress(this.resolveContainer()) as unknown as IProgress;
  }
  createToast(): IToast { return new WebToast(); }
  createTabs(container?: unknown): ITabs {
    return new WebTabs(this.resolveContainer(container)) as unknown as ITabs;
  }
  createCard(container?: unknown): ICard {
    return new WebCard(this.resolveContainer(container));
  }
  createInput(container?: unknown): IInput {
    return new WebInput(this.resolveContainer(container));
  }
  createSelect(container?: unknown): ISelect {
    return new WebSelect(this.resolveContainer(container));
  }
  createList(): IList { return new WebList(); }
  createPanel(container?: unknown): IPanel {
    return new WebPanel(this.resolveContainer(container));
  }
  createOverlay(): IOverlay {
    return new WebOverlay();
  }
}
