/**
 * 答题工具函数
 * @description 提供数据归一化、格式化等工具函数
 */

import { QuizProblem, Move } from './types';

/**
 * 打乱数组顺序（Fisher-Yates 洗牌算法）
 */
function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 归一化题目数据（用于答题页面）
 */
export function normalizeProblemForPage(problem: any, originalIndex?: number): QuizProblem {
  const position = normalizePosition(problem.position);
  const turn = (problem.turn || (position.length % 2 === 0 ? 'B' : 'W')) as 'B' | 'W';
  
  // 先处理选项数据
  let options = (problem.options || []).map((option: any, index: number) => {
    const coord = option.coord || option.position || '';
    const letter = option.letter || option.label || String.fromCharCode(65 + index);
    const rest = option.variations || option.variation || [];
    return {
      ...option,
      coord,
      letter,
      variation: buildVariation(turn, coord, rest),
      isPractical: option.isPractical || option.isBlunder || false,
      originalIndex: index, // 保存原始索引，用于追踪正确答案
    };
  });
  
  // 打乱选项顺序
  const originalCorrectIndex = problem.correctIndex ?? 0;
  options = shuffleArray(options);
  
  // 重新计算正确答案的索引
  let newCorrectIndex = 0;
  for (let i = 0; i < options.length; i++) {
    if (options[i].originalIndex === originalCorrectIndex) {
      newCorrectIndex = i;
      break;
    }
  }
  
  // 更新选项的 letter（根据打乱后的顺序）
  options = options.map((option, index) => ({
    ...option,
    letter: String.fromCharCode(65 + index), // A, B, C, ...
  }));
  
  return {
    ...problem,
    position,
    turn,
    options,
    correctIndex: newCorrectIndex,
    phase: problem.phase || 'middle',
    metadata: problem.metadata || {},
    __originalIndex: originalIndex ?? problem.__originalIndex,
  };
}

/**
 * 归一化局面数据
 */
export function normalizePosition(position: unknown): Move[] {
  if (Array.isArray(position)) return position as Move[];
  if (typeof position !== 'string') return [];
  const moves: Move[] = [];
  const re = /([BW])([a-z]{2})/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(position))) {
    moves.push({ color: match[1] as 'B' | 'W', coord: match[2]! });
  }
  return moves;
}

/**
 * 构建变化图序列
 */
export function buildVariation(
  firstColor: 'B' | 'W', 
  firstCoord: string, 
  restCoords: string[] | Move[]
): Move[] {
  const rest = (restCoords || [])
    .map((item: string | Move) => typeof item === 'string' ? item : item.coord)
    .filter(Boolean);
  const coords = [firstCoord, ...rest].filter(Boolean);
  return coords.map((coord, index) => ({
    color: index % 2 === 0 ? firstColor : oppositeColor(firstColor),
    coord,
  }));
}

/**
 * 获取对手颜色
 */
export function oppositeColor(color: 'B' | 'W'): 'B' | 'W' {
  return color === 'B' ? 'W' : 'B';
}

/**
 * 获取阶段文本
 */
export function getPhaseText(phase: string): string {
  return ({ layout: '布局', middle: '中盘', endgame: '官子' } as Record<string, string>)[phase] || '中盘';
}

/**
 * 获取等级文本
 */
export function getLevelText(level: string): string {
  return ({ 
    pro: '职业', 
    high: '高段', 
    normal: '普通', 
    '职业': '职业', 
    '高段': '高段', 
    '普通': '普通' 
  } as Record<string, string>)[level] || '普通';
}

/**
 * 设置文本内容
 */
export function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/**
 * 显示致命错误
 */
export function showFatal(message: string): void {
  setText('gameTitle', '加载失败');
  setText('blackName', message);
  setText('whiteName', '');
}

/**
 * 获取分组题目
 */
export function getGroupProblems(
  allProblems: QuizProblem[], 
  data: Record<string, unknown> | undefined, 
  groupIndex: number
): QuizProblem[] {
  const groups = data?.['gameGroups'] as Array<{ problemIndexes?: number[] }> | undefined;
  const group = Array.isArray(groups) && groupIndex >= 0 ? groups[groupIndex] : undefined;
  const indexes = group?.problemIndexes;
  if (!Array.isArray(indexes) || indexes.length === 0) return [];
  return indexes.map(i => allProblems[i]).filter((p): p is QuizProblem => Boolean(p));
}
