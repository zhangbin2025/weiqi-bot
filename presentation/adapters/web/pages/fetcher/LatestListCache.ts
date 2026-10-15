/**
 * 最新棋谱列表快照缓存
 * @module presentation/pages/fetcher/LatestListCache
 *
 * @description
 * 跳到其他页面再返回时，Android WebView / Electron 不支持 bfcache，会整页重载。
 * 之前的做法是「按缓存的 source + keyword 重新查一遍」，代价有两点：
 *   1. 白白多一次网络往返（OGS/101/GoProblems 都是在线接口）；
 *   2. 服务端顺序可能已变 —— 典型如 OGS 的 `-modified` 排序，抓详情会刷新
 *      该条目的 modified，刚看过的题自己跳到第 1 条，用户感知就是
 *      「看完返回，条目位置变了」。
 *
 * 改为把当次查询的 items 快照写进 sessionStorage，返回时直接用快照渲染，
 * 不重查 —— 列表顺序与离开时逐条一致，位置完全冻结。
 * 只有点「🔄 刷新」或切换来源/关键字时才会真正发起新查询。
 *
 * @design
 * - 只缓存 items，不缓存浏览位置：位置仍走既有的
 *   `fetcher_latest_selected` / `fetcher_latest_displayed` 两个细粒度键，
 *   由各选择动作单独维护（见 FetcherPage），避免快照与位置互相覆盖。
 * - 同时只保留一个来源的快照（写入前清理其它来源），既贴合「当前在看的
 *   就是这个来源」，也把 sessionStorage 占用锁死在单个上限内。
 * - 单条快照有体积上限（1MB）：超限则放弃缓存，退回重查路径。
 *   内置题库 4 万条约 5MB，历史上正是它撑爆 sessionStorage ~5MB 配额，
 *   故内置库来源直接不缓存（它是本地资源、约 100ms、且顺序确定不会变，
 *   重查也不会导致位置漂移）。
 * - 直播来源带较短 TTL：在线对局会不断结束/新增，快照不宜长期有效。
 */
import type { LatestGameItem } from '../../../../../application/fetcher';
import type { SessionStorageAdapter } from '../../../../../infrastructure/storage/adapters/web/SessionStorageAdapter';

/** 快照结构 */
export interface LatestListSnapshot {
  /** 来源标识 */
  source: string;
  /** 查询关键字（空串表示无关键字） */
  keyword: string;
  /** 列表条目 */
  items: LatestGameItem[];
  /** 写入时间戳（ms），用于 TTL 判定 */
  savedAt: number;
}

/** 快照键前缀（按来源分键） */
const KEY_PREFIX = 'fetcher_latest_snapshot_';
/** 单条快照的体积上限（字符数，约等于字节） */
const MAX_SNAPSHOT_BYTES = 1024 * 1024;
/** 默认有效期：30 分钟 */
const TTL_DEFAULT_MS = 30 * 60 * 1000;
/** 直播来源有效期：2 分钟（在线对局状态变化快） */
const TTL_LIVE_MS = 2 * 60 * 1000;
/** 直播类来源 */
const LIVE_SOURCES = new Set(['ogs-live', 'yike-live']);
/**
 * 不缓存的来源：内置棋谱库
 * 4 万条约 5MB，必然超出 sessionStorage 配额；且它是本地资源（~100ms）、
 * 顺序确定不变，重查既便宜又不会让条目位置漂移。
 */
const NO_CACHE_SOURCES = new Set(['lib-life-death', 'lib-ai-review']);

export class LatestListCache {
  constructor(private readonly store: SessionStorageAdapter) {}

  /** 写入快照（超限/不支持的来源静默跳过，不影响主流程） */
  async save(source: string, keyword: string, items: LatestGameItem[]): Promise<void> {
    if (NO_CACHE_SOURCES.has(source)) return;
    if (!items || items.length === 0) return;
    // 同一时刻只留当前来源的快照，避免多来源叠加撑爆配额
    await this.clearExcept(source);

    const payload: LatestListSnapshot = {
      source,
      keyword: keyword || '',
      items,
      savedAt: Date.now(),
    };

    let serialized: string;
    try {
      serialized = JSON.stringify(payload);
    } catch {
      return;
    }
    if (serialized.length > MAX_SNAPSHOT_BYTES) {
      console.warn('[LatestListCache] 快照超出体积上限，本次不缓存（返回时将重查）', {
        source,
        items: items.length,
        bytes: serialized.length,
      });
      return;
    }

    try {
      await this.store.write(this.key(source), payload);
    } catch (error) {
      console.warn('[LatestListCache] 快照写入失败，返回时将重查', {
        source,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.clear(source).catch(() => { /* ignore */ });
    }
  }

  /**
   * 读取快照
   * @returns 命中返回条目数组；未命中 / 关键字不符 / 已过期返回 null
   */
  async load(source: string, keyword: string): Promise<LatestGameItem[] | null> {
    if (NO_CACHE_SOURCES.has(source)) return null;
    const snap = await this.store.read<LatestListSnapshot>(this.key(source)).catch(() => null);
    if (!snap) return null;
    if (snap.source !== source) return null;
    if ((snap.keyword || '') !== (keyword || '')) return null;
    if (!Array.isArray(snap.items) || snap.items.length === 0) return null;
    if (Date.now() - (snap.savedAt || 0) > this.ttlOf(source)) return null;
    return snap.items;
  }

  /** 删除指定来源的快照 */
  async clear(source: string): Promise<void> {
    await this.store.delete(this.key(source)).catch(() => { /* ignore */ });
  }

  /** 删除所有来源的快照 */
  async clearAll(): Promise<void> {
    const keys = await this.store.listKeys(KEY_PREFIX + '*').catch(() => [] as string[]);
    for (const k of keys) await this.store.delete(k).catch(() => { /* ignore */ });
  }

  /** 清理除指定来源之外的快照 */
  private async clearExcept(source: string): Promise<void> {
    const keys = await this.store.listKeys(KEY_PREFIX + '*').catch(() => [] as string[]);
    for (const k of keys) {
      if (k !== this.key(source)) await this.store.delete(k).catch(() => { /* ignore */ });
    }
  }

  private key(source: string): string {
    return KEY_PREFIX + source;
  }

  private ttlOf(source: string): number {
    return LIVE_SOURCES.has(source) ? TTL_LIVE_MS : TTL_DEFAULT_MS;
  }
}
