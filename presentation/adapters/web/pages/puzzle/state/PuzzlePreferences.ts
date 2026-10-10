/**
 * 做题页面偏好持久化（题目来源 + 筛选条件）
 * @module presentation/adapters/web/pages/puzzle/state/PuzzlePreferences
 * @description 对齐 fetcher 页面：来源与「题型/难度」写入 localStorage（命名空间 weiqi-bot），
 *              刷新后恢复上次选择并按该条件出题。筛选条件仅在内置题库来源下生效，
 *              切到其他来源时保留条件、回到内置题库自动恢复。
 */
import { LocalStorageAdapter } from '../../../../../../infrastructure/storage/adapters/web/LocalStorageAdapter';
import type { PuzzleSource } from '../../../../../../application/puzzle/PuzzleApp';
import { PUZZLE_SOURCE_LABELS, DEFAULT_PUZZLE_SOURCE } from '../../../../../../application/puzzle/PuzzleApp';
import type { PuzzleFilterState } from '../../../../../../services/game/providers/library/puzzleFilter';
import { PUZZLE_FILTER_TYPES, buildPuzzleKeyword } from '../../../../../../services/game/providers/library/puzzleFilter';

/** localStorage 命名空间（与 fetcher 页面一致） */
const NAMESPACE = 'weiqi-bot';
/** 来源偏好键 */
const SOURCE_KEY = 'puzzle_source';
/** 筛选条件偏好键 */
const FILTER_KEY = 'puzzle_filter_state';
/** 选点显示偏好键（答题模式是否展示 A/B/C/D 选点） */
const SHOW_CHOICES_KEY = 'puzzle_show_choices';
/**
 * 旧版键名（页面内 readLocal 自行拼接 `puzzle_` 前缀导致重复）
 * 仅用于一次性兼容读取，写入一律走新键
 */
const LEGACY_KEYS: Record<string, string> = {
  [SOURCE_KEY]: `${NAMESPACE}:puzzle_puzzle_source`,
  [FILTER_KEY]: `${NAMESPACE}:puzzle_puzzle_filter_state`,
};

/** 内置题库来源（筛选条件仅在该来源下生效） */
const LIB_SOURCE: PuzzleSource = 'lib-life-death';

/**
 * 生成当前来源下生效的筛选关键字
 * @description 仅内置题库来源应用筛选；其他来源返回空串（不筛选）。
 *              筛选条件本身仍保留在偏好中，切回内置题库时自动恢复。
 * @param source - 题目来源
 * @param filter - 已保存的筛选条件，未设置过则为 null
 */
export function resolvePuzzleKeyword(source: PuzzleSource, filter: PuzzleFilterState | null): string {
  if (source !== LIB_SOURCE) return '';
  if (!filter) return '';
  return buildPuzzleKeyword(filter.types, filter.difficulty);
}

/**
 * 校验并清洗筛选条件
 * @description 剔除未知题型、补齐缺失字段；未设置过（键不存在或结构非法）返回 null。
 *              全空状态（题型空 + 难度空）视为「显式不筛选」，原样保留。
 */
function sanitizeFilter(raw: unknown): PuzzleFilterState | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const known = new Set(PUZZLE_FILTER_TYPES.map((t) => t.value));
  const rawTypes = obj['types'];
  const types = Array.isArray(rawTypes)
    ? rawTypes.filter((t): t is string => typeof t === 'string' && known.has(t))
    : [];
  const difficulty = typeof obj['difficulty'] === 'string' ? obj['difficulty'] : '';
  return { types, difficulty };
}

/** 做题页面偏好（来源 + 筛选条件）读写 */
export class PuzzlePreferences {
  private readonly store = new LocalStorageAdapter(NAMESPACE);
  private source: PuzzleSource = DEFAULT_PUZZLE_SOURCE;
  private filter: PuzzleFilterState | null = null;
  private showChoices = false;

  /** 从 localStorage 恢复偏好（读不到时回落到默认值） */
  async load(): Promise<void> {
    const source = await this.readKey<string>(SOURCE_KEY);
    if (typeof source === 'string' && PUZZLE_SOURCE_LABELS[source as PuzzleSource]) {
      this.source = source as PuzzleSource;
    }
    this.filter = sanitizeFilter(await this.readKey<unknown>(FILTER_KEY));
    const showChoices = await this.readKey<unknown>(SHOW_CHOICES_KEY);
    if (typeof showChoices === 'boolean') this.showChoices = showChoices;
  }

  /** 当前来源 */
  getSource(): PuzzleSource {
    return this.source;
  }

  /** 更新来源偏好并持久化 */
  setSource(source: PuzzleSource): void {
    if (!PUZZLE_SOURCE_LABELS[source]) return;
    this.source = source;
    void this.store.write(SOURCE_KEY, source).catch(() => { /* ignore */ });
  }

  /** 当前筛选条件（未设置过为 null） */
  getFilter(): PuzzleFilterState | null {
    return this.filter;
  }

  /** 更新筛选条件偏好并持久化 */
  setFilter(filter: PuzzleFilterState): void {
    this.filter = {
      types: Array.isArray(filter.types) ? [...filter.types] : [],
      difficulty: typeof filter.difficulty === 'string' ? filter.difficulty : '',
    };
    void this.store.write(FILTER_KEY, this.filter).catch(() => { /* ignore */ });
  }

  /** 答题模式是否显示选点（默认关闭） */
  getShowChoices(): boolean {
    return this.showChoices;
  }

  /** 更新选点显示偏好并持久化 */
  setShowChoices(show: boolean): void {
    this.showChoices = !!show;
    void this.store.write(SHOW_CHOICES_KEY, this.showChoices).catch(() => { /* ignore */ });
  }

  /**
   * 当前来源下生效的筛选关键字
   * @param source - 题目来源，省略时取当前来源
   */
  resolveKeyword(source: PuzzleSource = this.source): string {
    return resolvePuzzleKeyword(source, this.filter);
  }

  /** 读取偏好键，新键缺失时回落到旧版键名 */
  private async readKey<T>(key: string): Promise<T | null> {
    try {
      const value = await this.store.read<T>(key);
      return value === null ? this.readLegacy<T>(key) : value;
    } catch {
      return this.readLegacy<T>(key);
    }
  }

  /** 读取旧版键（一次性兼容，读失败返回 null） */
  private readLegacy<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(LEGACY_KEYS[key] ?? '');
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }
}
