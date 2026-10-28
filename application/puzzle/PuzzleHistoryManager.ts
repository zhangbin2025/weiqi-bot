/**
 * 做题历史管理器
 * @description 管理做题历史的记录、查询、统计（复用 ActivityLogService）。
 *              同一题目（按【棋形】识别）只保留一条记录：重复做会累加次数并合并结果，
 *              只要解出过一次即为「已解出」。
 */
import type { IActivityLogService, ActivityEntry, ActivityStats } from '../../services/activity';
import { md5 } from 'js-md5';
import { analyzeStrength, type StrengthReport } from './PuzzleStrengthAnalyzer';
import { splitPuzzleTags, evaluateFilter } from '../../services/game/providers/library/puzzleFilter';

export type { StrengthReport, RankEstimate, TypeStrength } from './PuzzleStrengthAnalyzer';

/** 初始局面摆子 */
export interface PuzzleInitialStone {
  x: number;
  y: number;
  color: 'black' | 'white';
}

/** 做题历史查询选项 */
export interface PuzzleHistoryOptions {
  keyword?: string;
  limit?: number;
  offset?: number;
}

/** 做题历史条目 */
export interface PuzzleHistoryEntry {
  id: string;
  /** 题目 URL（内置题库为 lib://...，在线题为原始链接） */
  url: string;
  /** 题目标题（内置题库为 #序号，在线题为题名） */
  title: string;
  /** 来源标识：lib-life-death / weiqi101 / goproblems / ogs-puzzle */
  source: string;
  /** 题目标签（内置题库为「类型·难度」，如 死活题·5D） */
  tag: string;
  /** 是否曾解出（做过但没解出为 false） */
  success: boolean;
  /** 本题累计做过次数 */
  attempts: number;
  /** 最近一次的用户落子手数 */
  moves: number;
  /** 最近一次耗时（毫秒） */
  duration: number;
  /** 最近一次做题时间（毫秒时间戳） */
  solvedAt: number;
  /** 棋盘路数，用于缩略图还原 */
  boardSize: number;
  /** 题目初始局面摆子，用于渲染缩略图 */
  initialStones: PuzzleInitialStone[];
}

/** 做题统计 */
export interface PuzzleStats {
  total: number;
  success: number;
  failed: number;
  today: number;
  /** 平均耗时（毫秒），无记录为 0 */
  avgDuration: number;
}

/** 做题结果（用于记录） */
export interface PuzzleResult {
  url: string;
  title: string;
  source: string;
  tag: string;
  /** 本次是否解出 */
  success: boolean;
  attempts: number;
  moves: number;
  duration: number;
  /** 棋盘路数，用于缩略图还原 */
  boardSize: number;
  /** 题目初始局面摆子，用于渲染缩略图 */
  initialStones: PuzzleInitialStone[];
}

/** 活动日志中的做题类型标识 */
export const PUZZLE_ACTIVITY_TYPE = 'puzzle';

/** 内置题库做题记录的 URL 前缀（只有内置题库的题带「类型·难度」标签，参与筛选计数） */
const LIB_LIFE_DEATH_PREFIX = 'lib://life-and-death/';

/** 历史扫描上限：题库约 4.5 万题，取 10 万留足余量 */
const HISTORY_SCAN_LIMIT = 100000;

/** 棋盘路数上限（19 路是标准最大路数） */
const MAX_BOARD_SIZE = 19;

/**
 * 由包围盒尺寸推算最小标准路数（9 / 13 / 19）
 *
 * @description 与 domain/sgf/TsumegoMinBoard 的 roundUpToStandard 同口径：
 *   ≤9→9，≤13→13，其余→19。取宽高中的较大者，保证棋形装得下且是正方形。
 *
 *   为什么【路数要参与 hash】而又【不能取实际棋盘路数】：
 *   - 要参与：9 路与 19 路上的同形摆子是两道不同的题，不该合并；
 *   - 不能取实际值：同一道题会因解题着法/压缩策略不同而被摆到 9 路或 19 路盘上，
 *     实际路数会漂。
 *
 *   解法：路数【由初始局面自身算出】（包围盒 → 最小标准路数），
 *   它是棋形的确定函数 —— 平移、换日期、换序号都不改变它，
 *   而真正不同的棋形会得到不同的路数。
 */
function minimalBoardSize(width: number, height: number): number {
  const m = Math.max(width, height);
  if (m <= 9) return 9;
  if (m <= 13) return 13;
  return MAX_BOARD_SIZE;
}

/**
 * 计算题目「初始局面棋形」的规范哈希（平移/旋转/镜像无关，含最小路数）
 *
 * 为什么不能用 URL 去重：内置题库 url 形如 lib://life-and-death/<日期>/<序号>，
 *   日期每天随数据更新变（实测 10-26 → 10-27），序号因题库增删整体平移
 *   （实测同一题 10-26 是 /4，10-27 变成 /7）。跨天后 url 几乎必然对不上，
 *   于是「昨天做过的题」今天被判成新题 → 已做数一路涨过总数。
 *
 * 为什么不能用 SGF 内容：解题着法一变，SGF 就变，contentMd5 跟着变。
 *
 * 唯一不变量是【棋形】：黑子集合 + 白子集合的相对排布。
 *   算法：
 *   ① 由包围盒算出最小标准路数 n（9/13/19）；
 *   ② 在 n×n 正方形内做 8 对称展开（4 旋转 × 2 镜像）；
 *   ③ 每个变体平移到包围盒原点，序列化为规范串；
 *   ④ 取字典序最小的规范串，连同 n 一起 md5。
 *
 * @description 【不参与】黑白互换：同一棋形黑先 / 白先是两道不同的题，
 *              合并会把「同一形状的两个题目」错误判成一题。
 *
 * @param stones - 初始局面摆子（题目摆好的子，不含后续落子）
 * @param boardSize - 摆子所在棋盘路数（仅用于过滤越界脏数据，不参与 hash）
 * @returns 规范棋形哈希（32 位 hex）；无摆子（空枰题）时返回 null，
 *          调用方应回落到 url 去重
 */
export function puzzleShapeHash(
  stones: PuzzleInitialStone[] | undefined | null,
  boardSize?: number,
): string | null {
  if (!stones || stones.length === 0) return null;

  const limit = boardSize && boardSize > 0 ? boardSize : MAX_BOARD_SIZE;
  const black: Array<[number, number]> = [];
  const white: Array<[number, number]> = [];
  for (const s of stones) {
    // 越界 / 非整数：脏数据直接整体放弃（宁可回落 url，也不算出一个错棋形）
    if (!Number.isInteger(s.x) || !Number.isInteger(s.y)) return null;
    if (s.x < 0 || s.y < 0 || s.x >= limit || s.y >= limit) return null;
    if (s.color === 'black') black.push([s.x, s.y]);
    else if (s.color === 'white') white.push([s.x, s.y]);
  }
  if (black.length === 0 && white.length === 0) return null;

  // ① 最小路数：由包围盒推算（与平移无关）
  let minX0 = Infinity;
  let maxX0 = -Infinity;
  let minY0 = Infinity;
  let maxY0 = -Infinity;
  for (const [x, y] of [...black, ...white]) {
    if (x < minX0) minX0 = x;
    if (x > maxX0) maxX0 = x;
    if (y < minY0) minY0 = y;
    if (y > maxY0) maxY0 = y;
  }
  const n = minimalBoardSize(maxX0 - minX0 + 1, maxY0 - minY0 + 1);

  // ② 8 对称展开：4 旋转 × 2 镜像
  //   rot90: (x,y) → (y, n-1-x)     镜像: (x,y) → (n-1-x, y)
  const variants: string[] = [];
  for (let flip = 0; flip < 2; flip++) {
    for (let rot = 0; rot < 4; rot++) {
      const tf = (pt: [number, number]): [number, number] => {
        let [x, y] = pt;
        if (flip) x = n - 1 - x;
        for (let r = 0; r < rot; r++) {
          const nx = y;
          const ny = n - 1 - x;
          x = nx;
          y = ny;
        }
        return [x, y];
      };
      const b = black.map(tf);
      const w = white.map(tf);
      // ③ 归一化原点用【黑白合并后】的包围盒左上角：
      //    分开归零会破坏两色的相对位置（「全黑」与「一黑一白」会塌成同一题）
      let minX = Infinity;
      let minY = Infinity;
      for (const [x, y] of [...b, ...w]) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
      }
      const norm = (pts: Array<[number, number]>): string =>
        pts
          .map(([x, y]) => `${x - minX},${y - minY}`)
          .sort()
          .join(';');
      variants.push(`B${norm(b)}|W${norm(w)}`);
    }
  }

  // ④ 取字典序最小的规范串，连同路数 n 一起哈希
  //    n 参与可区分「9 路上的小棋形」与「19 路上的同形摆子」
  variants.sort();
  return md5(`${n}|${variants[0]!}`).toLowerCase();
}

/**
 * 取历史条目的去重键：优先棋形哈希，缺失时【现算】，再不行才回落 URL
 *
 * @description 存量数据（本次改动前写入）没有 shapeHash 字段，但存了
 *              initialStones —— 可以就地算出棋形哈希。
 *
 *              ⚠️ 必须现算而不能用 url：用户手上的历史是按【旧 url】写的，
 *              若对老数据回落 url，那么「昨天的 499 条」与「今天新做的」
 *              永远是两个键，已做数照样突破总数 —— 修复对存量数据就失效了。
 */
function dedupeKeyOf(entry: ActivityEntry): string {
  const stored = entry.data['shapeHash'] as string | null | undefined;
  if (typeof stored === 'string' && stored) return 's:' + stored;
  // 存量数据：用其摆子现算；算不出（空枰/无摆子）才回落 url
  const computed = puzzleShapeHash(
    entry.data['initialStones'] as PuzzleInitialStone[] | undefined,
    entry.data['boardSize'] as number | undefined,
  );
  if (computed) return 's:' + computed;
  return 'u:' + ((entry.data['url'] as string) ?? '');
}

/**
 * 做题历史管理器
 */
export class PuzzleHistoryManager {
  constructor(private readonly activityLogService?: IActivityLogService) {}

  /**
   * 记录一次做题
   *
   * 同一题目（【棋形】相同）合并为一条记录：
   * - 次数累加，最近信息（手数/耗时/时间）刷新
   * - 只要解出过一次，success 保持 true
   * - 缩略图数据（路数/摆子）缺失时补齐
   *
   * @description 合并依据从 URL 改为棋形哈希：内置题库 url 含日期与序号，
   *              每天都变（见 puzzleShapeHash 注释），按 url 合并会导致
   *              「昨天做过的题」今天被记成新题，已做数因此超过总题数。
   *              老数据无 shapeHash 时回落 url 匹配。
   */
  async record(result: PuzzleResult): Promise<string | undefined> {
    if (!this.activityLogService) return undefined;

    const shapeHash = puzzleShapeHash(result.initialStones, result.boardSize);
    const existing = await this.findExisting(result.url, shapeHash);
    const tags = ['做题', result.source, result.tag].filter(Boolean) as string[];

    if (existing) {
      const prevSuccess = (existing.data['success'] as boolean) ?? false;
      const prevAttempts = (existing.data['attempts'] as number) ?? 0;
      const prevStones = (existing.data['initialStones'] as PuzzleInitialStone[]) ?? [];
      const prevSize = (existing.data['boardSize'] as number) ?? 0;
      const success = prevSuccess || result.success;
      const data: Record<string, unknown> = {
        ...existing.data,
        title: result.title || existing.data['title'],
        tag: result.tag || existing.data['tag'],
        source: result.source || existing.data['source'],
        success,
        attempts: prevAttempts + Math.max(1, result.attempts),
        moves: result.moves,
        duration: result.duration,
        boardSize: prevSize || result.boardSize,
        initialStones: prevStones.length > 0 ? prevStones : result.initialStones,
        // 老记录被棋形命中时补上哈希，后续合并可直接走棋形
        shapeHash: (existing.data['shapeHash'] as string | undefined) ?? shapeHash ?? undefined,
      };
      // 更新时间戳，让最近做过的题排在最前
      await this.activityLogService.update?.(existing.id, {
        data,
        ...(tags.length > 0 ? { tags } : {}),
        createdAt: Date.now(),
      });
      return existing.id;
    }

    return this.activityLogService.record(
      PUZZLE_ACTIVITY_TYPE,
      `做题：${result.title}`.trim(),
      {
        url: result.url,
        title: result.title,
        source: result.source,
        tag: result.tag,
        success: result.success,
        attempts: Math.max(1, result.attempts),
        moves: result.moves,
        duration: result.duration,
        boardSize: result.boardSize,
        initialStones: result.initialStones,
        // 空枰题（无摆子）算不出棋形：存 null 让后续显式回落 url，
        // 而不是与「未计算」混为一谈
        shapeHash: shapeHash ?? null,
      },
      tags,
    );
  }

  /**
   * 查找同一道题的已有记录（棋形优先，url 回落）
   *
   * 匹配顺序：
   *   ① url 完全相同 —— 同一天同一序号，最快路径
   *   ② 棋形哈希相同 —— 跨日期 / 跨路数 / 换序号的同题
   *      （只比带 shapeHash 的记录；老数据无此字段，避免 null 误互配）
   *   ③ 都没有 → null（新题）
   *
   * @description 扫描上限用 HISTORY_SCAN_LIMIT 而非 1000：
   *              历史超过 1000 条后，旧实现连同 url 都找不到，每次都新建记录。
   */
  private async findExisting(url: string, shapeHash: string | null): Promise<ActivityEntry | null> {
    const entries = (await this.activityLogService?.query({
      type: PUZZLE_ACTIVITY_TYPE,
      limit: HISTORY_SCAN_LIMIT,
    })) ?? [];

    if (url) {
      const byUrl = entries.find((e) => e.data['url'] === url);
      if (byUrl) return byUrl;
    }
    if (shapeHash) {
      // 已存哈希的直接命中
      const byShape = entries.find((e) => e.data['shapeHash'] === shapeHash);
      if (byShape) return byShape;
      // 存量数据（本次改动前写入）没有 shapeHash 字段：用其 initialStones 现算。
      // 不补算的话，用户已有的历史永远匹配不上，修复对其存量数据形同虚设。
      const legacy = entries.find((e) => {
        if (e.data['shapeHash'] !== undefined) return false;
        const stones = e.data['initialStones'] as PuzzleInitialStone[] | undefined;
        const size = e.data['boardSize'] as number | undefined;
        return puzzleShapeHash(stones, size) === shapeHash;
      });
      if (legacy) return legacy;
    }
    return null;
  }

  /** 按题目 URL 查找已有记录（兼容旧调用；新代码请用 findExisting） */
  private async findByUrl(url: string): Promise<ActivityEntry | null> {
    return this.findExisting(url, null);
  }

  /** 查询做题历史 */
  async query(options?: PuzzleHistoryOptions): Promise<PuzzleHistoryEntry[]> {
    if (!this.activityLogService) return [];
    const entries = await this.activityLogService.query({
      type: PUZZLE_ACTIVITY_TYPE,
      keyword: options?.keyword,
      limit: options?.limit ?? 20,
      offset: options?.offset,
    });
    return entries.map((e: ActivityEntry) => ({
      id: e.id,
      url: (e.data['url'] as string) ?? '',
      title: (e.data['title'] as string) ?? '',
      source: (e.data['source'] as string) ?? '',
      tag: (e.data['tag'] as string) ?? '',
      success: (e.data['success'] as boolean) ?? false,
      attempts: (e.data['attempts'] as number) ?? 0,
      moves: (e.data['moves'] as number) ?? 0,
      duration: (e.data['duration'] as number) ?? 0,
      solvedAt: e.createdAt,
      boardSize: (e.data['boardSize'] as number) ?? 19,
      initialStones: (e.data['initialStones'] as PuzzleInitialStone[]) ?? [],
    }));
  }

  /** 获取单条历史详情 */
  async getDetail(id: string): Promise<ActivityEntry | null> {
    return this.activityLogService?.getById(id) ?? null;
  }

  /** 获取统计信息 */
  async getStats(): Promise<PuzzleStats> {
    const stats = (await this.activityLogService?.stats()) ?? ({ total: 0, today: 0 } as ActivityStats);
    const entries = (await this.activityLogService?.query({ type: PUZZLE_ACTIVITY_TYPE, limit: 1000 })) ?? [];
    let success = 0;
    let failed = 0;
    let durationSum = 0;
    for (const e of entries) {
      if (e.data['success'] as boolean) success++;
      else failed++;
      durationSum += (e.data['duration'] as number) ?? 0;
    }
    return {
      total: entries.length,
      success,
      failed,
      today: stats.today,
      avgDuration: entries.length > 0 ? Math.round(durationSum / entries.length) : 0,
    };
  }

  /**
   * 统计「符合当前筛选条件且已做过」的题数（内置题库专用）
   *
   * 口径（必须与 listPuzzles 一致，否则「已做 20 / 共 600」的分子分母不同源）：
   * - 只统计内置题库记录（url 以 lib://life-and-death/ 开头）；
   *   在线来源的题没有「类型·难度」标签，无法参与题型/难度筛选。
   * - 按【棋形哈希】去重：同一题反复做只算一题，且跨日期/路数仍认得。
   *   ⚠️ 不能按 url 去重 —— url 里的日期与序号每天都变（见 puzzleShapeHash），
   *      否则「昨天做完 499 题」今天继续做会一路涨到 500、501，超过总数。
   * - 用题库同款 evaluateFilter 判定标签是否命中当前筛选表达式。
   *
   * @param keyword - 筛选表达式（如 "(官子 or 死活) and 2D"）；空串表示不筛选，
   *                  此时返回「已做的内置题库题总数」
   * @returns 去重后的已做题数；无历史服务时为 0
   */
  async countMatchingKeyword(keyword?: string): Promise<number> {
    const kw = keyword?.trim() || '';
    const entries = (await this.activityLogService?.query({
      type: PUZZLE_ACTIVITY_TYPE,
      limit: HISTORY_SCAN_LIMIT,
    })) ?? [];
    const seen = new Set<string>();
    let count = 0;
    for (const e of entries) {
      const url = (e.data['url'] as string) ?? '';
      // 非内置题库题：无标签，不参与筛选计数
      if (!url.startsWith(LIB_LIFE_DEATH_PREFIX)) continue;
      // 同一题多次做只计一次（按棋形，缺失时回落 url）
      const key = dedupeKeyOf(e);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!kw) { count++; continue; }
      const tag = (e.data['tag'] as string) ?? '';
      // 标签缺失（历史导入 / 老数据）无法判定命中，保守不计入
      if (!tag) continue;
      if (evaluateFilter(kw, splitPuzzleTags(tag))) count++;
    }
    return count;
  }

  /**
   * 获取「已做过的内置题库题目」的棋形哈希集合
   *
   * 供出题排序使用：未做过的题优先出，做过的题靠后排。
   * 判定口径：只要历史里有记录就算已做（不论对错）—— 错题也该让位给新题。
   *
   * @description 从 URL 集合改为【棋形哈希】集合：
   *              内置题库 url 的日期/序号每天变，按 url 判「是否做过」会导致
   *              昨天做过的题今天全被当成新题 → 一上来就重复出题。
   *              只认内置题库记录（lib://life-and-death/），与 countMatchingKeyword 同源。
   *
   * @returns 已做题棋形哈希集合（无 shapeHash 的老数据用 'u:'+url 占位）；
   *          无历史服务时为空集合
   */
  async getDoneShapeHashes(): Promise<Set<string>> {
    const entries = (await this.activityLogService?.query({
      type: PUZZLE_ACTIVITY_TYPE,
      limit: HISTORY_SCAN_LIMIT,
    })) ?? [];
    const done = new Set<string>();
    for (const e of entries) {
      const url = (e.data['url'] as string) ?? '';
      // 非内置题库题：在线来源没有稳定的题目 ID，不参与「未做优先」排序
      if (!url.startsWith(LIB_LIFE_DEATH_PREFIX)) continue;
      // 同时写入两种键：
      //   s:<棋形哈希> —— 跨日期/跨路数认题（列表项一旦带上棋形即可命中）
      //   u:<url>      —— 列表项当前只有 url，同日内靠它命中「未做优先」
      done.add(dedupeKeyOf(e));
      if (url) done.add('u:' + url);
    }
    return done;
  }

  /**
   * 获取「已做过的内置题库题目」的 URL 集合
   * @deprecated 仅用于兼容老调用方。内置题库 url 含日期且每天变化，
   *             按 url 判「是否做过」在跨天后必然失效，请改用 getDoneShapeHashes。
   */
  async getDoneUrls(): Promise<Set<string>> {
    const entries = (await this.activityLogService?.query({
      type: PUZZLE_ACTIVITY_TYPE,
      limit: HISTORY_SCAN_LIMIT,
    })) ?? [];
    const done = new Set<string>();
    for (const e of entries) {
      const url = (e.data['url'] as string) ?? '';
      if (!url.startsWith(LIB_LIFE_DEATH_PREFIX)) continue;
      done.add(url);
    }
    return done;
  }

  /**
   * 获取完整统计报告（常规统计 + 棋力评估）
   * @description 基于全部历史（同一题目已合并为一条记录）分析，不做时间范围过滤。
   */
  async getStrengthReport(): Promise<StrengthReport> {
    const entries = await this.query({ limit: 10000 });
    return analyzeStrength(entries);
  }

  /** 导入历史 */
  async importHistory(json: string): Promise<number> {
    const data = JSON.parse(json) as PuzzleResult[];
    let count = 0;
    for (const item of data) {
      await this.record(item);
      count++;
    }
    return count;
  }

  /** 导出历史 */
  async exportHistory(): Promise<string> {
    const entries = await this.query({ limit: 10000 });
    return JSON.stringify(entries, null, 2);
  }

  /** 清空历史 */
  async clearHistory(): Promise<void> {
    await this.activityLogService?.clear(PUZZLE_ACTIVITY_TYPE);
  }
}
