/**
 * 决策面板接口
 * @module presentation/core/interfaces/IDecisionPanel
 */
import type { IDecisionOption } from '../../../domain/decision';
/**
 * 决策面板接口（选点答题 UI）
 * @ai-example
 * const panel: IDecisionPanel = {
 *   setOptions: (options) => { ... },
 *   showFeedback: (selected, isCorrect, correct) => { ... },
 *   ...
 * };
 */
export interface IDecisionPanel {
  /** 设置选项 */
  setOptions(options: IDecisionOption[]): void;
  /** 显示答题反馈 */
  showFeedback(selectedIndex: number, isCorrect: boolean, correctIndex: number): void;
  /** 清除反馈 */
  clearFeedback(): void;
  /** 显示变化图按钮 */
  showVariationButton(optionIndex: number): void;
  /** 禁用选项 */
  disableOptions(): void;
  /** 启用选项 */
  enableOptions(): void;
  /** 渲染 */
  render(): void;
  /** 销毁 */
  destroy(): void;
}
