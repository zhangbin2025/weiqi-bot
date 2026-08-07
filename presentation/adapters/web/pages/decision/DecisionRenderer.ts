/**
 * 决策题渲染器
 * @module presentation/pages/decision/DecisionRenderer
 */
import type { ICard } from '../../../../core/interfaces';
import type { IDecisionProblem } from '../../../../../domain/decision';
export function renderProblem(
  card: ICard,
  problem: IDecisionProblem,
  index: number,
  total: number
): void {
  const lines = [
    `第 ${index + 1}/${total} 题`,
    '',
    `难度: ${problem.difficulty}`,
    `阶段: ${problem.phase}`,
    `手数: ${problem.metadata.moveNumber}`,
    '',
    '选择最佳着法:',
    ...problem.options.map((opt, i) => `${i + 1}. ${opt.label} (${(opt.winrate * 100).toFixed(1)}%)`),
  ];
  card.setContent(lines.join('\n'));
  card.render();
}
export function renderFeedback(
  card: ICard,
  problem: IDecisionProblem,
  selectedIndex: number,
  isCorrect: boolean
): void {
  const correctOption = problem.options[problem.correctIndex];
  const selectedOption = problem.options[selectedIndex];
  if (!correctOption || !selectedOption) return;
  const lines = [
    isCorrect ? '✅ 回答正确！' : '❌ 回答错误',
    '',
    `你的选择: ${selectedOption.label} (${(selectedOption.winrate * 100).toFixed(1)}%)`,
    `正确答案: ${correctOption.label} (${(correctOption.winrate * 100).toFixed(1)}%)`,
  ];
  card.setContent(lines.join('\n'));
  card.render();
}