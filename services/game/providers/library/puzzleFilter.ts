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

/** 「全部难度」选项值（空串：不按难度筛选） */
export const PUZZLE_FILTER_ALL_DIFFICULTY = '';

/** 「全部难度」选项（置于难度下拉首位，用于显式回到不筛选状态） */
export const PUZZLE_FILTER_ALL_DIFFICULTY_OPTION: { value: string; label: string } = {
  value: PUZZLE_FILTER_ALL_DIFFICULTY,
  label: '全部难度',
};

/**
 * 难度选项（复选，15K→7D，共 22 项）
 * @description 内置题库主要来源于 101，最低难度约 15K，30K 以下无题，
 *              故从 15K 起（15K~1K 共 15 项 + 1D~7D 共 7 项）。
 */
export const PUZZLE_FILTER_DIFFICULTIES: readonly string[] = (() => {
  const arr: string[] = [];
  for (let k = 15; k >= 1; k--) arr.push(k + 'K');
  for (let d = 1; d <= 7; d++) arr.push(d + 'D');
  return arr;
})();

/** 题库筛选状态（题型复选 + 难度复选） */
export interface PuzzleFilterState {
  types: string[];
  /** 难度复选（1 个=单难度，多个=or 组合，空=全部难度） */
  difficulties: string[];
  /**
   * @deprecated 旧版单值难度，仅用于兼容历史 localStorage 数据（{"difficulty":"3D"}）。
   *             运行时一律以 difficulties 为准，新代码不要读写该字段。
   */
  difficulty?: string;
}

/** 默认筛选状态：首项题型，无难度 */
export function defaultPuzzleFilterState(): PuzzleFilterState {
  return {
    types: [PUZZLE_FILTER_TYPES[0]!.value],
    difficulties: [],
  };
}

/**
 * 归一化难度入参为数组
 * @description 兼容历史单值字符串（旧版偏好里存的是 '3D'）；空串/空数组视为「全部难度」。
 */
export function normalizeDifficulties(difficulties: string[] | string | undefined | null): string[] {
  const pick = (d: unknown): d is string => typeof d === 'string' && !!d.trim();
  if (Array.isArray(difficulties)) return difficulties.filter(pick);
  if (typeof difficulties === 'string') return pick(difficulties) ? [difficulties] : [];
  return [];
}

/**
 * 根据题型（复选）与难度（复选）生成筛选关键字串（and/or 语法）
 * @example buildPuzzleKeyword(['死活','官子'], ['2D']) => '(死活 or 官子) and 2D'
 * @example buildPuzzleKeyword(['死活'], ['3D','4D']) => '死活 and (3D or 4D)'
 */
export function buildPuzzleKeyword(types: string[], difficulties: string[] | string): string {
  const diffList = normalizeDifficulties(difficulties);
  const parts: string[] = [];
  if (types.length === 1) {
    parts.push(types[0]!);
  } else if (types.length > 1) {
    parts.push('(' + types.join(' or ') + ')');
  }
  if (diffList.length === 1) {
    parts.push(diffList[0]!);
  } else if (diffList.length > 1) {
    parts.push('(' + diffList.join(' or ') + ')');
  }
  return parts.join(' and ');
}

/**
 * 归一化筛选状态（脏数据清洗 + 旧版兼容）
 * @description 剔除未知题型；难度统一收敛为数组，旧版单值 difficulty 自动迁移。
 * @param raw - 任意来源（localStorage JSON / 弹框回传）
 */
export function normalizePuzzleFilterState(raw: unknown): PuzzleFilterState {
  const obj = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  const knownTypes = new Set(PUZZLE_FILTER_TYPES.map((t) => t.value));
  const rawTypes = obj['types'];
  const types = Array.isArray(rawTypes)
    ? rawTypes.filter((t): t is string => typeof t === 'string' && knownTypes.has(t))
    : [];
  const rawDiff = obj['difficulties'] ?? obj['difficulty'];
  return { types, difficulties: normalizeDifficulties(rawDiff as string[] | string | undefined) };
}
