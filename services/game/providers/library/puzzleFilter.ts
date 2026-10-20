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

// ==================== 筛选表达式求值 ====================
/**
 * 题库标签（由 PW 字段「类型·难度」拆分而来）
 * @example 「死活题·5D」→ { type: '死活题', difficulty: '5D', raw: '死活题·5D' }
 */
export interface PuzzleTags {
  type: string;
  difficulty: string;
  raw: string;
}

/**
 * 从标签原文拆分「类型·难度」
 * @description 不依赖 SGF 全文，供 meta 索引路径与历史计数复用。
 */
export function splitPuzzleTags(raw: string): PuzzleTags {
  if (!raw.includes('·')) {
    // 仅类型（无难度分隔符）
    return { type: raw, difficulty: '', raw };
  }
  const [type, difficulty] = raw.split('·').map(s => s.trim());
  return { type: type || '', difficulty: difficulty || '', raw };
}

/**
 * 判断难度是否匹配难度型原子。
 * 难度型原子（如 "5K"、"2D+"）锚定到难度段：
 *   - 大小写不敏感，按确切数字匹配（避免 "5K" 误命中 "15K"）；
 *   - 不带 “+” 的原子（如 "2D"）匹配同数字的同级（2D 与 2D+ 均命中）；
 *   - 带 “+” 的原子（如 "2D+"）仅匹配带 “+” 的同级。
 */
function difficultyMatches(difficulty: string, atom: string): boolean {
  const diff = difficulty.toUpperCase();
  const a = atom.toUpperCase();
  if (!/^\d+[KD]\+?$/.test(a)) return false;
  const m = a.match(/^(\d+)([KD])(\+)?$/);
  if (!m) return false;
  const targetNum = parseInt(m[1]!, 10);
  const targetRank = m[2]!;
  const targetPlus = !!m[3];
  // 解析难度段（可能含多个，如 "2D+ 死活题" 里取 2D+）
  const candidates = diff.match(/\d+[KD]\+?/g);
  if (!candidates) return false;
  return candidates.some(c => {
    const cm = c.match(/^(\d+)([KD])(\+)?$/);
    if (!cm) return false;
    const num = parseInt(cm[1]!, 10);
    const rank = cm[2]!;
    const plus = !!cm[3];
    if (rank !== targetRank || num !== targetNum) return false;
    return targetPlus ? plus : true; // "2D+" 只匹配 2D+；"2D" 匹配 2D 与 2D+
  });
}

/**
 * 判断题库标签是否匹配一个筛选原子（类型或难度）。
 * - 类型原子：对 raw（类型·难度）做大小写不敏感子串匹配。
 * - 难度原子（^\d+[KD]\+?）：走 difficultyMatches 边界匹配。
 */
function atomMatches(tags: PuzzleTags, atom: string): boolean {
  const a = atom.trim().toUpperCase();
  if (!a) return true;
  if (/^\d+[KD]\+?$/.test(a)) return difficultyMatches(tags.difficulty, a);
  return tags.raw.toUpperCase().includes(a);
}

/**
 * 筛选表达式求值：支持括号、and、or，大小写不敏感。
 *
 * 语法：
 *   expr   := term ('or' term)*
 *   term   := factor ('and' factor)*
 *   factor := '(' expr ')' | atom
 * 连续原子之间默认视为 and（兼容单关键字模糊匹配）。
 * 空表达式始终匹配。
 *
 * @description 与内置题库列表筛选共用同一实现 —— 已做题数必须与列表口径一致，
 *              否则「已做 20 / 共 600」里的分子会与分母用两套标准统计。
 */
export function evaluateFilter(expr: string, tags: PuzzleTags): boolean {
  const tokens = expr
    .replace(/\(/g, ' ( ')
    .replace(/\)/g, ' ) ')
    .trim()
    .split(/\s+/)
    .map(t => t.toLowerCase());
  if (tokens.length === 0) return true;

  let pos = 0;
  function peek(): string | undefined { return tokens[pos]; }
  function parseExpr(): boolean {
    let left = parseTerm();
    while (peek() !== undefined && peek() === 'or') {
      pos++;
      const right = parseTerm(); // 必须先解析右侧以推进 pos（避免短路导致的死循环）
      left = left || right;
    }
    return left;
  }
  function parseTerm(): boolean {
    let left = parseFactor();
    while (
      peek() !== undefined &&
      (peek() === 'and' || (peek() !== 'or' && peek() !== ')'))
    ) {
      if (peek() === 'and') pos++;
      const right = parseFactor(); // 必须先解析右侧以推进 pos（避免短路导致的死循环）
      left = left && right;
      if (peek() === 'and') pos++;
    }
    return left;
  }
  function parseFactor(): boolean {
    const t = peek();
    if (t === '(') { pos++; const v = parseExpr(); if (peek() === ')') pos++; return v; }
    if (t === 'and' || t === 'or' || t === undefined || t === ')') return true; // 空因子
    pos++;
    return atomMatches(tags, t);
  }

  const result = parseExpr();
  return result;
}
