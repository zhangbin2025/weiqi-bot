/**
 * 适配器工厂
 * @module presentation/adapters/AdapterFactory
 *
 * 根据平台自动选择合适的组件实现。
 * Web/Electron 环境下，可调用 setRootContainer() 设置组件挂载的根容器，
 * 之后创建的组件会自动挂入该容器。
 * 部分组件支持 container 参数，可将组件挂载到指定容器（如 IPanel 内部）。
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
  IPanel,
  IPanelChild,
  ISelect,
  IList,
} from '../core/interfaces';
import type { Platform } from './PlatformDetector';
import { PlatformDetector } from './PlatformDetector';
import { WebBoard } from './web/components/Board';
import { WebButton } from './web/components/Button';
import { WebCard } from './web/components/Card';
import { WebDialog } from './web/components/Dialog';
import { WebInput } from './web/components/Input';
import { WebList } from './web/components/List';
import { WebNotification } from './web/components/Notification';
import { WebPanel } from './web/components/Panel';
import { WebProgress } from './web/components/Progress';
import { WebSelect } from './web/components/Select';
import { WebTabs } from './web/components/Tabs';
import { WebToast } from './web/components/Toast';
export class AdapterFactory {
  private static rootContainer: unknown = null;
  static setRootContainer(container: unknown): void {
    AdapterFactory.rootContainer = container;
  }
  static getPlatform(): Platform {
    return PlatformDetector.detect();
  }
  /** 解析容器：优先用传入的，否则用全局根容器 */
  private static resolveContainer(override?: unknown): HTMLElement | undefined {
    if (override instanceof HTMLElement) return override;
    return AdapterFactory.rootContainer instanceof HTMLElement
      ? AdapterFactory.rootContainer
      : undefined;
  }
  static createBoard(): IBoard {
    const platform = this.getPlatform();
    switch (platform) {
      case 'web':
      case 'electron':
        return new WebBoard(this.resolveContainer());
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
  /** 创建按钮，可指定挂载容器 */
  static createButton(container?: unknown): IButton {
    const platform = this.getPlatform();
    switch (platform) {
      case 'web':
      case 'electron':
        return new WebButton(this.resolveContainer(container)) as unknown as IButton;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
  static createNotification(): INotification {
    const platform = this.getPlatform();
    switch (platform) {
      case 'web':
      case 'electron':
        return new WebNotification() as unknown as INotification;
      default:
        throw new Error('Notification not supported on this platform');
    }
  }
  static createDialog(): IDialog {
    const platform = this.getPlatform();
    switch (platform) {
      case 'web':
      case 'electron':
        return new WebDialog();
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
  static createProgress(): IProgress {
    const platform = this.getPlatform();
    switch (platform) {
      case 'web':
      case 'electron':
        return new WebProgress(this.resolveContainer()) as unknown as IProgress;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
  static createToast(): IToast {
    const platform = this.getPlatform();
    switch (platform) {
      case 'web':
      case 'electron':
        return new WebToast();
      default:
        throw new Error('Toast not supported on this platform');
    }
  }
  static createTabs(): ITabs {
    const platform = this.getPlatform();
    switch (platform) {
      case 'web':
      case 'electron':
        return new WebTabs(this.resolveContainer()) as unknown as ITabs;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
  /** 创建卡片，可指定挂载容器 */
  static createCard(container?: unknown): ICard {
    const platform = this.getPlatform();
    switch (platform) {
      case 'web':
      case 'electron':
        return new WebCard(this.resolveContainer(container));
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
  /** 创建输入框，可指定挂载容器 */
  static createInput(container?: unknown): IInput {
    const platform = this.getPlatform();
    switch (platform) {
      case 'web':
      case 'electron':
        return new WebInput(this.resolveContainer(container));
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
  static createSelect(): ISelect {
    const platform = this.getPlatform();
    switch (platform) {
      case 'web':
      case 'electron':
        return new WebSelect();
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
  static createList(): IList {
    const platform = this.getPlatform();
    switch (platform) {
      case 'web':
      case 'electron':
        return new WebList();
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
  /** 创建面板容器，可指定挂载容器 */
  static createPanel(container?: unknown): IPanel {
    const platform = this.getPlatform();
    switch (platform) {
      case 'web':
      case 'electron':
        return new WebPanel(this.resolveContainer(container));
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
}
