/**
 * shared/ui - 公共 UI 控件入口
 *
 * 使用：
 *   import { Dialog, Select } from '../shared/ui';
 *   await Dialog.alert('xxx');
 *   Select.mountAll();
 *   const v = Select.get('#mySelect')?.getValue();
 */
export { Dialog } from './Dialog';
export type { AlertOptions, ConfirmOptions, DialogBaseOptions } from './Dialog';
export { Select } from './Select';
export type { SelectInstance, SelectOption, SelectOptions } from './Select';
