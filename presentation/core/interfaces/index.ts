/**
 * 核心接口导出
 * @module presentation/core/interfaces
 */
export type { IBoard, IBoardConfig } from './IBoard';
export type { IButton, IButtonConfig, ButtonVariant, ButtonSize } from './IButton';
export type { ICard, ICardConfig } from './ICard';
export type { IDialog, IDialogConfig, DialogResult, DialogType, DialogInputType } from './IDialog';
export type { ITabs, ITabsConfig, TabItem } from './ITabs';
export type { IToast, IToastConfig, ToastType } from './IToast';
export type {
  INotification,
  INotificationItem,
  NotificationType,
  NotificationPriority,
  NotificationAction,
} from './INotification';
export type { IProgress, IProgressConfig } from './IProgress';
export type { IInput, IInputConfig, InputType, InputState } from './IInput';
export type { IPage, IPageConfig, PageParams } from './IPage';
export type { IDecisionPanel } from './IDecisionPanel';
export type { IPanel, IPanelChild } from './IPanel';
export type { ISelect, ISelectConfig, ISelectOption } from './ISelect';
export type { IList, IListConfig, IListItem } from './IList';
export type { IAdapterFactory } from './IAdapterFactory';
export type { IPageCache } from './IPageCache';
export type { IOverlay } from './IOverlay';
