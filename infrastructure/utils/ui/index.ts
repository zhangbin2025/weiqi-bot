/**
 * UI 模块导出
 */
export { UIManager } from './UIManager';
export type {
  PageRoute,
  UIState,
  Platform,
  IUIController,
  PlayMode,
  PageParams
} from './types';

export {
  WebUIController,
  ElectronUIController,
  MobileUIController,
  MiniProgramUIController,
  TerminalUIController
} from './adapters';
