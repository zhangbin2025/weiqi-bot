/**
 * 答题面板UI组件
 * @description 显示ABCD选项和下一题按钮
 * @module presentation/adapters/web/pages/decision/DecisionPanel
 */
import type { IDecisionOption } from '../../../../../domain/decision';
/** 答题面板配置 */
export interface DecisionPanelConfig {
  /** 容器元素 */
  container: HTMLElement;
  /** 选择答案回调 */
  onSelect: (optionIndex: number) => void;
  /** 下一题回调 */
  onNext: () => void;
}
/** 答题面板状态 */
export interface DecisionPanelState {
  options: IDecisionOption[];
  answered: boolean;
  selectedIndex: number | null;
  correctIndex: number;
}
/**
 * 答题面板UI组件
 */
export class DecisionPanel {
  private container: HTMLElement;
  private onSelect: (optionIndex: number) => void;
  private onNext: () => void;
  private state: DecisionPanelState = {
    options: [],
    answered: false,
    selectedIndex: null,
    correctIndex: 0,
  };
  constructor(config: DecisionPanelConfig) {
    this.container = config.container;
    this.onSelect = config.onSelect;
    this.onNext = config.onNext;
  }
  /**
   * 设置选项
   */
  setOptions(options: IDecisionOption[], correctIndex: number): void {
    this.state = {
      options,
      answered: false,
      selectedIndex: null,
      correctIndex,
    };
    this.render();
  }
  /**
   * 显示答题结果
   */
  showAnswerResult(selectedIndex: number, isCorrect: boolean): void {
    this.state.answered = true;
    this.state.selectedIndex = selectedIndex;
    this.render();
  }
  /**
   * 渲染面板
   */
  private render(): void {
    const { options, answered, selectedIndex, correctIndex } = this.state;
    if (options.length === 0) {
      this.container.innerHTML = '';
      return;
    }
    const buttonsHtml = options.map((opt, idx) => {
      let btnClass = 'btn-option neutral';
      if (answered) {
        if (idx === correctIndex) {
          btnClass = 'btn-option correct';
        } else if (idx === selectedIndex) {
          btnClass = 'btn-option wrong';
        }
      }
      return `<button class="btn ${btnClass}" data-option="${idx}" ${answered ? 'disabled' : ''}>${opt.letter}</button>`;
    }).join('');
    this.container.innerHTML = `
      <div class="decision-panel">
        <div class="decision-buttons">
          ${buttonsHtml}
        </div>
        ${answered ? '<button class="btn btn-primary" id="nextProblemBtn">下一题</button>' : ''}
      </div>
    `;
    this.bindEvents();
  }
  /**
   * 绑定事件
   */
  private bindEvents(): void {
    // 选项按钮
    this.container.querySelectorAll('.btn-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        if (this.state.answered) return;
        const optionIndex = parseInt((e.target as HTMLElement).dataset['option']!, 10);
        this.onSelect(optionIndex);
      });
    });
    // 下一题按钮
    const nextBtn = this.container.querySelector('#nextProblemBtn');
    nextBtn?.addEventListener('click', () => this.onNext());
  }
  /**
   * 销毁组件
   */
  destroy(): void {
    this.container.innerHTML = '';
  }
}
