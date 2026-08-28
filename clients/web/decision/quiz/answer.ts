/**
 * 答题逻辑
 * @description 处理答题选择和结果显示
 */

import { state, currentProblem, resetAnswerState } from './state';
import { syncBoard, highlightLastMove, markOptions } from './board';
import { startVariation } from './variation';
import { QuizProblem } from './types';

/**
 * 选择选项（答题）
 */
export function selectOption(index: number): void {
  if (state.answered) return;

  const problem = currentProblem();
  state.answered = true;
  state.selectedOptionIndex = index;
  const isCorrect = index === problem.correctIndex;

  // 播放音效
  if (state.soundEnabled && state.audioPlayer) {
    state.audioPlayer.play(isCorrect ? 'correct' : 'wrong');
  }

  // 显示结果卡片
  showResultCard(index, problem.correctIndex, problem);

  // 答题后显示选点标记（让用户看到答案位置）
  markOptions();

  // 高亮最后一手
  highlightLastMove();
}

/**
 * 显示结果卡片
 */
export function showResultCard(
  selectedIndex: number, 
  correctIndex: number,
  problem: QuizProblem
): void {
  const resultCard = document.getElementById('resultCard');
  const resultStatus = document.getElementById('resultStatus');
  const resultIcon = document.getElementById('resultIcon');
  const resultText = document.getElementById('resultText');
  const optionsList = document.getElementById('optionsList');

  if (!resultCard || !resultStatus || !resultIcon || !resultText || !optionsList) return;

  const isCorrect = selectedIndex === correctIndex;

  // 设置状态
  resultStatus.className = `result-status ${isCorrect ? 'correct' : 'wrong'}`;
  resultIcon.textContent = isCorrect ? '✓' : '✗';
  resultText.textContent = isCorrect ? '答对了' : '答错了';

  // 渲染选项列表
  optionsList.innerHTML = '';
  problem.options.forEach((option, index) => {
    const item = document.createElement('div');
    const isCorrectItem = index === correctIndex;
    const isSelectedItem = index === selectedIndex;

    // 使用 isPractical 字段
    const isPractical = option.isPractical || false;

    let itemClasses = 'option-item';
    if (isCorrectItem) itemClasses += ' correct';
    if (!isCorrectItem && isSelectedItem) itemClasses += ' wrong';
    if (isSelectedItem) itemClasses += ' selected';

    item.className = itemClasses;

    // 选项标签（一选/二选/实战命中1选 等）
    const letterDiv = document.createElement('div');
    letterDiv.className = 'option-letter';
    letterDiv.textContent = option.letter || option.label;

    // 信息
    const infoDiv = document.createElement('div');
    infoDiv.className = 'option-info';

    const labelDiv = document.createElement('div');
    labelDiv.className = 'option-label';
    // 直接使用 label 字段，它已经包含完整的描述（一选/二选/实战命中N选/实战N选）
    labelDiv.textContent = option.label;
    if (isPractical) {
      labelDiv.classList.add('practical');
    } else if (isCorrectItem) {
      labelDiv.classList.add('correct');
    }

    const winrateDiv = document.createElement('div');
    winrateDiv.className = 'option-winrate';
    winrateDiv.textContent = option.winrate !== undefined ? `${option.winrate.toFixed(1)}%` : '-';

    infoDiv.appendChild(labelDiv);
    infoDiv.appendChild(winrateDiv);

    // 指示器
    const indicatorDiv = document.createElement('div');
    indicatorDiv.className = 'option-indicator';
    if (isSelectedItem && !isCorrectItem) indicatorDiv.textContent = '❌';
    if (isSelectedItem && isCorrectItem) indicatorDiv.textContent = '✅';
    if (!isSelectedItem && isCorrectItem) indicatorDiv.textContent = '⭐';

    item.appendChild(letterDiv);
    item.appendChild(infoDiv);
    item.appendChild(indicatorDiv);
    
    // 添加点击事件，查看变化图
    item.addEventListener('click', () => {
      startVariation(index);
    });
    item.style.cursor = 'pointer';
    
    optionsList.appendChild(item);
  });

  // 显示卡片
  resultCard.classList.remove('hidden');
}
