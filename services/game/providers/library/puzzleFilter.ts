/**
 * 题库筛选公共模块
 * @module services/game/providers/library/puzzleFilter
 * @description 题型/难度筛选常量与关键字表达式生成。
 *              fetcher 最新列表与做题页面共用，避免两处维护。
 */

/** 题型选项（复选），值即题库标签子串 */
export const PUZZLE_FILTER_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: '布局', label: '布局' },
  { value: '死活', label: '死活' },
  { value: '官子', label: '官子' },
  { value: '中盘', label: '中盘' },
  { value: '对杀', label: '对杀' },
  { value: '手筋', label: '手筋' },
  { value: '棋理', label: '棋理' },
];

/** 难度选项（单选，30K→7D） */
export const PUZZLE_FILTER_DIFFICULTIES: readonly string[] = (() => {
  const arr: string[] = [];
  for (let k = 30; k >= 1; k--) arr.push(k + 'K');
  for (let d = 1; d <= 7; d++) arr.push(d + 'D');
  return arr;
})();

/** 题库筛选状态（题型复选 + 难度单选） */
export interface PuzzleFilterState {
  types: string[];
  difficulty: string;
}

/** 默认筛选状态：首项题型，无难度 */
export function defaultPuzzleFilterState(): PuzzleFilterState {
  return {
    types: [PUZZLE_FILTER_TYPES[0]!.value],
    difficulty: '',
  };
}

/**
 * 根据题型（复选）与难度（单选）生成筛选关键字串（and/or 语法）
 * @example buildPuzzleKeyword(['死活','官子'], '2D') => '(死活 or 官子) and 2D'
 */
export function buildPuzzleKeyword(types: string[], difficulty: string): string {
  const parts: string[] = [];
  if (types.length === 1) {
    parts.push(types[0]!);
  } else if (types.length > 1) {
    parts.push('(' + types.join(' or ') + ')');
  }
  if (difficulty) parts.push(difficulty);
  return parts.join(' and ');
}
