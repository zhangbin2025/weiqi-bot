/**
 * 做题页会话状态持久化
 * @module presentation/adapters/web/pages/puzzle/state/PuzzleSessionStore
 *
 * @description
 * 解决「跳打谱页看棋谱后返回，题目被换掉」的问题。
 *
 * 根因：做题页的题库列表（items）、当前下标（currentIndex）、当前题目 URL
 * 全都只存在于内存中。跳打谱页是一次整页导航（window.location.href），
 * 返回时页面重新加载，内存状态清零 → loadPuzzleList() 重新拉题库并随机打乱
 * → 必然换题。单题模式（从 fetcher/历史跳入）尤其致命：URL 参数丢失后
 * 连「回到那一道题」的入口都没有。
 *
 * 方案：把「恢复一道题所需的最小状态」写入 sessionStorage，
 * 页面初始化时优先从缓存恢复，命中则不再随机出题。
 * 用 sessionStorage（而非 localStorage）：标签页关闭即失效，
 * 符合「本次做题会话」的语义，不会让下次打开 app 莫名回到旧题。
 */
import { SessionStorageAdapter } from '../../../../../../infrastructure/storage/adapters/web/SessionStorageAdapter';
import type { PuzzleSource } from '../../../../../../application/puzzle/PuzzleApp';
import { PUZZLE_SOURCE_LABELS } from '../../../../../../application/puzzle/PuzzleApp';
import type { PuzzleItem } from '../../../../../../application/puzzle/PuzzleApp';

/** sessionStorage 命名空间（与 fetcher 页一致） */
const NAMESPACE = 'weiqi-bot';
/** 当前题目缓存键 */
const KEY_CURRENT = 'puzzle_current';
/** 题库进度缓存键 */
const KEY_PROGRESS = 'puzzle_progress';

/** 当前题目快照（足以重新加载同一道题） */
export interface PuzzleCurrentSnapshot {
  /** 题目抓取 URL（内置题库为 lib://...，在线题为 https://...） */
  url: string;
  /** 题目标题 */
  title: string;
  /** 题目标签（内置题库为「类型·难度」） */
  tag: string;
  /** 题目来源 */
  source: PuzzleSource;
  /** 是否处于单题模式（从 fetcher / 历史跳入） */
  singlePuzzle: boolean;
}

/** 题库进度快照（恢复后「换题」能接着往下走，不重头开始） */
export interface PuzzleProgressSnapshot {
  /** 题库条目 */
  items: PuzzleItem[];
  /** 当前下标 */
  currentIndex: number;
  /** 条目对应的来源 */
  itemsSource: PuzzleSource | '';
  /** 条目对应的筛选关键字 */
  itemsKeyword: string;
  /** 是否达到单次加载上限 */
  itemsCapped: boolean;
  /** 每条已出轮次号 */
  usedCycle: number[];
  /** 当前轮次号 */
  cycle: number;
}

/** 做题页会话状态读写 */
export class PuzzleSessionStore {
  private readonly store = new SessionStorageAdapter(NAMESPACE);
  /** sessionStorage 不可用（隐私模式 / 配额满）时降级为纯内存，不抛错 */
  private readonly memory = new Map<string, unknown>();
  private readonly available: boolean;

  constructor() {
    this.available = this.store.isAvailable();
  }

  /** 保存当前题目（每次载入新题时调用） */
  saveCurrent(snapshot: PuzzleCurrentSnapshot): void {
    void this.write(KEY_CURRENT, snapshot);
  }

  /** 读取当前题目缓存 */
  async loadCurrent(): Promise<PuzzleCurrentSnapshot | null> {
    const raw = await this.read<Partial<PuzzleCurrentSnapshot>>(KEY_CURRENT);
    // 校验：无 url 或来源非法视为缓存损坏，丢弃
    if (!raw || typeof raw.url !== 'string' || !raw.url) return null;
    if (typeof raw.source !== 'string' || !PUZZLE_SOURCE_LABELS[raw.source as PuzzleSource]) {
      return null;
    }
    return {
      url: raw.url,
      title: typeof raw.title === 'string' ? raw.title : '',
      tag: typeof raw.tag === 'string' ? raw.tag : '',
      source: raw.source as PuzzleSource,
      singlePuzzle: raw.singlePuzzle === true,
    };
  }

  /** 保存题库进度 */
  saveProgress(snapshot: PuzzleProgressSnapshot): void {
    void this.write(KEY_PROGRESS, snapshot);
  }

  /**
   * 读取题库进度缓存
   * @param source - 期望的来源，不匹配则视为失效（换过来源就该重新拉）
   * @param keyword - 期望的筛选关键字
   */
  async loadProgress(source: PuzzleSource, keyword: string): Promise<PuzzleProgressSnapshot | null> {
    const raw = await this.read<Partial<PuzzleProgressSnapshot>>(KEY_PROGRESS);
    if (!raw || !Array.isArray(raw.items)) return null;
    if (raw.itemsSource !== source || raw.itemsKeyword !== keyword) return null;
    const items = raw.items.filter(
      (it): it is PuzzleItem => !!it && typeof it.url === 'string' && typeof it.title === 'string',
    );
    if (items.length === 0) return null;
    // 下标合法性兜底：题库被外部改动过数组长度时夹紧到有效范围
    const currentIndex = typeof raw.currentIndex === 'number' && raw.currentIndex >= 0
      ? Math.min(raw.currentIndex, items.length - 1)
      : -1;
    const usedCycle = Array.isArray(raw.usedCycle) && raw.usedCycle.length === items.length
      ? raw.usedCycle.map((n) => (typeof n === 'number' ? n : 0))
      : new Array(items.length).fill(0);
    return {
      items,
      currentIndex,
      itemsSource: source,
      itemsKeyword: keyword,
      itemsCapped: raw.itemsCapped === true,
      usedCycle,
      cycle: typeof raw.cycle === 'number' && raw.cycle > 0 ? raw.cycle : 1,
    };
  }

  /** 清除当前题目缓存（主动换题 / 退出单题模式时调用） */
  clearCurrent(): void {
    void this.remove(KEY_CURRENT);
  }

  /** 清除全部做题会话缓存 */
  clearAll(): void {
    void this.remove(KEY_CURRENT);
    void this.remove(KEY_PROGRESS);
  }

  // ==================== 底层读写（不可用时降级内存） ====================

  private async write(key: string, value: unknown): Promise<void> {
    if (!this.available) {
      this.memory.set(key, value);
      return;
    }
    try {
      await this.store.write(key, value);
    } catch {
      // 配额超限等异常：降级内存，不阻断做题流程
      this.memory.set(key, value);
    }
  }

  private async read<T>(key: string): Promise<T | null> {
    if (!this.available) return (this.memory.get(key) as T) ?? null;
    try {
      return await this.store.read<T>(key);
    } catch {
      return (this.memory.get(key) as T) ?? null;
    }
  }

  private async remove(key: string): Promise<void> {
    this.memory.delete(key);
    if (!this.available) return;
    try {
      await this.store.delete(key);
    } catch {
      /* ignore */
    }
  }
}
