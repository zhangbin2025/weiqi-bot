/**
 * Web 决策面板组件
 */
import type { IDecisionPanel } from '../../../core/interfaces';
import type { IDecisionOption } from '../../../../domain/decision';
export class WebDecisionPanel implements IDecisionPanel {
  private container: HTMLElement;
  private options: IDecisionOption[] = [];
  private selectedIndex: number | null = null;
  private buttons: HTMLButtonElement[] = [];
  private onOptionClick?: (index: number) => void;
  private onVariationClick?: (index: number) => void;
  private disabled = false;
  constructor(container: HTMLElement) {
    this.container = container;
    this.container.className = 'decision-panel';
  }
  setOptions(options: IDecisionOption[]): void {
    this.options = options;
    this.selectedIndex = null;
    this.render();
  }
  showFeedback(selectedIndex: number, isCorrect: boolean, correctIndex: number): void {
    this.selectedIndex = selectedIndex;
    this.buttons.forEach((btn, idx) => {
      btn.classList.remove('correct', 'wrong');
      if (idx === correctIndex) {
        btn.classList.add('correct');
        const mark = document.createElement('span');
        mark.className = 'decision-mark';
        mark.textContent = ' ✓';
        btn.appendChild(mark);
      } else if (idx === selectedIndex && !isCorrect) {
        btn.classList.add('wrong');
        const mark = document.createElement('span');
        mark.className = 'decision-mark';
        mark.textContent = ' ✗';
        btn.appendChild(mark);
      }
    });
    this.disableOptions();
  }
  clearFeedback(): void {
    this.buttons.forEach(btn => {
      btn.classList.remove('correct', 'wrong');
      const mark = btn.querySelector('.decision-mark');
      if (mark) mark.remove();
    });
    this.selectedIndex = null;
  }
  showVariationButton(optionIndex: number): void {
    if (optionIndex < 0 || optionIndex >= this.options.length) return;
    const btn = this.buttons[optionIndex];
    if (!btn) return;
    const variationBtn = document.createElement('button');
    variationBtn.className = 'decision-variation-btn';
    variationBtn.textContent = '查看变化';
    variationBtn.onclick = (e) => {
      e.stopPropagation();
      this.onVariationClick?.(optionIndex);
    };
    btn.appendChild(variationBtn);
  }
  disableOptions(): void {
    this.disabled = true;
    this.buttons.forEach(btn => (btn.disabled = true));
  }
  enableOptions(): void {
    this.disabled = false;
    this.buttons.forEach(btn => (btn.disabled = false));
  }
  setOnOptionClick(callback: (index: number) => void): void {
    this.onOptionClick = callback;
  }
  setOnVariationClick(callback: (index: number) => void): void {
    this.onVariationClick = callback;
  }
  render(): void {
    this.container.innerHTML = '';
    this.buttons = [];
    const grid = document.createElement('div');
    grid.className = 'decision-options-grid';
    this.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'decision-option-btn';
      btn.type = 'button';
      const label = document.createElement('span');
      label.className = 'decision-option-label';
      label.textContent = opt.label;
      const winrate = document.createElement('span');
      winrate.className = 'decision-option-winrate';
      winrate.textContent = `${opt.winrate.toFixed(1)}%`;
      btn.appendChild(label);
      btn.appendChild(winrate);
      btn.onclick = () => {
        if (!this.disabled && this.onOptionClick) {
          this.onOptionClick(idx);
        }
      };
      this.buttons.push(btn);
      grid.appendChild(btn);
    });
    this.container.appendChild(grid);
  }
  destroy(): void {
    this.container.innerHTML = '';
    this.buttons = [];
    this.options = [];
  }
}