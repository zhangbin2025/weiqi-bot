/**
 * 棋力评估分析器
 * @module application/puzzle/PuzzleStrengthAnalyzer
 * @description 基于做题历史评估用户棋力（15K~7D）。
 *
 * 设计要点：
 * 1. 难度量化：15K…1K → 1…15，1D…7D → 16…22；带 "+"（如 2D+）额外 +0.5 级。
 * 2. 通过率插值：每个难度级统计通过率，向全局通过率做贝叶斯式收缩（平滑），
 *    再找到通过率跌破 50% 的跨越点做线性插值 —— 50% 通过率对应的难度即棋力。
 * 3. 边界：最难题也全对 → 天花板（≥xD）；最易题也过半失败 → 地板（≤xK）。
 * 4. 纯函数、无外部依赖，便于单测。
 */
import type { PuzzleHistoryEntry } from './PuzzleHistoryManager';

/** 最低难度级（15K） */
export const LEVEL_MIN = 1;
/** 最高难度级（7D） */
export const LEVEL_MAX = 22;
/** 难度级 → 段位名的分界：level<=15 为级位，>=16 为段位 */
const DAN_START = 16;
/** 平滑强度（等效先验样本数），抑制少量样本造成的通过率跳变 */
const SMOOTH_K = 2;
/** 判定通过率阈值（棋力 = 正确率 50% 所对应的难度） */
const THRESHOLD = 0.5;
/** 给出分型棋力所需的最少样本数 */
const MIN_RATED_SAMPLES = 3;
/** 置信度样本门槛 */
const CONF_HIGH = 20;
const CONF_MEDIUM = 8;

/** 题型分类（与筛选常量 PUZZLE_FILTER_TYPES 对齐，去掉「题」字后缀后归一化） */
export const PUZZLE_TYPES: readonly string[] = [
  '布局', '死活', '官子', '中盘', '对杀', '手筋', '棋理',
];
/** 未能归类的题型 */
export const PUZZLE_TYPE_OTHER = '其他';

/** 棋力估算结果 */
export interface RankEstimate {
  /** 量化难度级（浮点，1~22） */
  level: number;
  /** 棋力主值，如 "3D" / "5K" */
  rank: string;
  /** 浮动区间 [下限, 上限]，如 ["2D", "4D"] */
  range: [string, string];
  /** 置信度：样本充足度 */
  confidence: 'high' | 'medium' | 'low';
  /** 参与评估的样本数 */
  sampleCount: number;
  /** 触到地板（最易的题正确率也不足 50%） */
  hitFloor: boolean;
  /** 触到天花板（最难的题正确率仍过半） */
  hitCeiling: boolean;
  /** 样本是否足够支撑结论（false 时 level/rank 不可信） */
  described: boolean;
}

/** 单个题型的统计与棋力 */
export interface TypeStrength {
  /** 题型名 */
  type: string;
  /** 该题型的做题总数（含无难度 / 未认真作答的题，与题型分布一致） */
  count: number;
  /** 解出数（同上口径） */
  correct: number;
  /** 正确率（0~1，同上口径） */
  rate: number;
  /** 参与棋力评估的有效样本数（可能小于 count） */
  rated: number;
  /** 该题型棋力（无有效样本为 null） */
  estimate: RankEstimate | null;
}

/** 常规统计 */
export interface StrengthSummary {
  /** 历史条目总数（按题目去重后的记录数） */
  total: number;
  /** 曾解出题数 */
  success: number;
  /** 未解出题数 */
  failed: number;
  /** 总正确率（0~1） */
  rate: number;
  /** 今日做题数 */
  today: number;
  /** 近 7 日做题数 */
  thisWeek: number;
  /** 近 30 日做题数 */
  thisMonth: number;
  /** 平均耗时（毫秒） */
  avgDuration: number;
  /** 参与棋力评估的有效样本数 */
  rated: number;
  /** 被排除的样本数（未认真作答 / 无难度标签） */
  unrated: number;
}

/** 难度档分布 */
export interface DifficultyBucketStat {
  /** 档位名 */
  label: string;
  /** 题数 */
  count: number;
  /** 解出数 */
  correct: number;
  /** 正确率（0~1） */
  rate: number;
}

/** 完整统计报告 */
export interface StrengthReport {
  /** 综合棋力（跨题型统一拟合，样本不足为 null） */
  overall: RankEstimate | null;
  /** 各题型统计与棋力 */
  byType: TypeStrength[];
  /** 常规统计 */
  summary: StrengthSummary;
  /** 题型分布（按题数降序） */
  typeDistribution: DifficultyBucketStat[];
  /** 难度档分布（级位档 / 段位档） */
  difficultyDistribution: DifficultyBucketStat[];
  /** 一句话点评 */
  comment: string;
}

/** 内部：一个难度级上的聚合桶 */
interface Bucket {
  level: number;
  n: number;
  s: number;
}

/** 内部：PAVA 合并后的单调块 */
interface MonotoneBlock {
  /** 权重和 */
  w: number;
  /** 加权通过率和（w*p 之和） */
  wp: number;
  /** 块内最小难度级（插值下界） */
  minLevel: number;
  /** 块内最大难度级（插值上界） */
  maxLevel: number;
}

/**
 * 量化难度级 → 段位名
 * @param level - 1~22（15K…1K → 1…15，1D…7D → 16…22）
 * @description 小数按四舍五入取到整数级（如 17.6 → 3D）
 */
export function levelToRank(level: number): string {
  const clamped = Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, level));
  const rounded = Math.round(clamped);
  if (rounded < DAN_START) {
    return `${16 - rounded}K`;
  }
  return `${rounded - 15}D`;
}

/**
 * 从题目标签中解析难度级
 * @param tag - 题目标签，形如「死活题·5D」「3 dan」「5段」「15 kyu」
 * @returns 量化难度级（1~22），无法解析返回 null
 */
export function parseDifficulty(tag: string): number | null {
  if (!tag) return null;
  const raw = tag.toUpperCase();

  // 形式一：数字 + K/D + 可选 +（内置题库：5D、2D+、15K、1K+）
  const m1 = raw.match(/(\d{1,2})\s*\+\s*[KD]/); // 形如 "5 + D"（GoProblems 的 "5 + dan" 已转大写截取）
  const m2 = raw.match(/(\d{1,2})\s*([KD])\s*(\+)?/);
  if (m2) {
    const num = parseInt(m2[1]!, 10);
    if (m2[2] === 'D' && num >= 1 && num <= 7) {
      const base = 15 + num;
      return Math.min(LEVEL_MAX, base + (m2[3] ? 0.5 : 0));
    }
    if (m2[2] === 'K' && num >= 1 && num <= 15) {
      const base = 16 - num;
      return Math.max(LEVEL_MIN, base + (m2[3] ? 0.5 : 0));
    }
  }
  void m1;

  // 形式二：中文「5段」「5级」
  const m3 = tag.match(/(\d{1,2})\s*段/);
  if (m3) {
    const num = parseInt(m3[1]!, 10);
    if (num >= 1 && num <= 7) return Math.min(LEVEL_MAX, 15 + num);
  }
  const m4 = tag.match(/(\d{1,2})\s*级/);
  if (m4) {
    const num = parseInt(m4[1]!, 10);
    if (num >= 1 && num <= 15) return Math.max(LEVEL_MIN, 16 - num);
  }

  // 形式三：英文 "3 dan" / "15 kyu"（GoProblems 的 rank 文本）
  const m5 = raw.match(/(\d{1,2})\s*(DAN|KYU)/);
  if (m5) {
    const num = parseInt(m5[1]!, 10);
    if (m5[2] === 'DAN' && num >= 1 && num <= 7) return Math.min(LEVEL_MAX, 15 + num);
    if (m5[2] === 'KYU' && num >= 1 && num <= 15) return Math.max(LEVEL_MIN, 16 - num);
  }
  return null;
}

/**
 * 从题目标签中解析题型
 * @param tag - 题目标签，形如「死活题·5D」
 * @returns 归一化的题型名，未匹配返回「其他」
 */
export function parsePuzzleType(tag: string): string {
  if (!tag) return PUZZLE_TYPE_OTHER;
  for (const t of PUZZLE_TYPES) {
    if (tag.includes(t)) return t;
  }
  return PUZZLE_TYPE_OTHER;
}

/**
 * 判断是否「认真作答」（用于排除瞎点记录）
 * @description 选点题本身只要一手棋，故允许 moves===1，但需耗时达标（≥2s）；
 *              moves≥2 视为已实际尝试，不再看耗时；moves===0 一律排除。
 */
export function isSeriousAttempt(entry: Pick<PuzzleHistoryEntry, 'moves' | 'duration'>): boolean {
  const moves = entry.moves ?? 0;
  if (moves <= 0) return false;
  if (moves >= 2) return true;
  return (entry.duration ?? 0) >= 2000;
}

/** 置信度：按样本数分档 */
function confidenceOf(n: number): RankEstimate['confidence'] {
  if (n >= CONF_HIGH) return 'high';
  if (n >= CONF_MEDIUM) return 'medium';
  return 'low';
}

/**
 * 保序回归（PAVA）：把「难度↑ → 通过率↓」的序列约束成非递增
 * @param items - 按难度升序的 {level, p, w}
 * @returns 非递增序列，每项给出块内通过率与代表难度
 * @description 真实数据常非单调（低难度题反而错得多，多为随手做或漏做的噪声）。
 *              直接用原始序列找跨越点会被单个噪声桶带偏，故先做保序平滑。
 */
function isotonicNonIncreasing(
  items: Array<{ level: number; p: number; w: number }>,
): Array<{ level: number; high: number; p: number; w: number }> {
  const blocks: MonotoneBlock[] = items.map((it) => ({
    w: it.w,
    wp: it.w * it.p,
    minLevel: it.level,
    maxLevel: it.level,
  }));

  for (let i = 0; i < blocks.length; i++) {
    let cur = blocks[i]!;
    // 违反非递增（后一块通过率高于前一块）→ 合并
    while (i > 0) {
      const prev = blocks[i - 1]!;
      if (prev.wp / prev.w >= cur.wp / cur.w - 1e-9) break;
      prev.w += cur.w;
      prev.wp += cur.wp;
      prev.minLevel = Math.min(prev.minLevel, cur.minLevel);
      prev.maxLevel = Math.max(prev.maxLevel, cur.maxLevel);
      blocks.splice(i, 1);
      i--;
      cur = prev;
    }
  }

  return blocks.map((b) => ({
    level: b.minLevel,
    high: b.maxLevel,
    p: b.wp / b.w,
    w: b.w,
  }));
}

/**
 * 按难度桶拟合棋力（核心算法）
 * @param buckets - 难度桶（内部会按 level 升序排序）
 * @param globalRate - 全局通过率，作为平滑先验
 * @description 流程：平滑 → 保序回归（PAVA）→ 找通过率跌破 50% 的跨越点线性插值。
 */
function fitLevel(buckets: Bucket[], globalRate: number): Omit<RankEstimate, 'sampleCount' | 'confidence'> {
  const sorted = [...buckets].sort((a, b) => a.level - b.level);
  const totalN = sorted.reduce((acc, b) => acc + b.n, 0);
  if (sorted.length === 0 || totalN === 0) {
    return {
      level: LEVEL_MIN, rank: levelToRank(LEVEL_MIN),
      range: [levelToRank(LEVEL_MIN), levelToRank(LEVEL_MIN)],
      hitFloor: false, hitCeiling: false, described: false,
    };
  }

  // 平滑通过率：向全局通过率收缩，避免小样本 0/1 跳变
  const smoothed = sorted.map((b) => ({
    level: b.level,
    p: (b.s + SMOOTH_K * globalRate) / (b.n + SMOOTH_K),
    w: b.n,
  }));

  // 保序回归：难度越高通过率不得反升
  const mono = isotonicNonIncreasing(smoothed);

  // 找第一个跌破 50% 的块
  const idx = mono.findIndex((m) => m.p < THRESHOLD);

  let level: number;
  let hitFloor = false;
  let hitCeiling = false;

  if (idx === 0) {
    // 最易的题正确率都不足一半 → 地板：只知道「低于最低已测难度」。
    // 向下取整：全错 15K+ 只能说明低于 15K+，不能因 "+" 的 0.5 编码反向抬到 14K。
    level = Math.floor(sorted[0]!.level);
    hitFloor = true;
  } else if (idx === -1) {
    // 最难的题正确率仍过半 → 天花板：只知道「不低于最高已测难度」。
    // 向下取整：全对 14K+ 只能说明至少 14K，没有证据支撑已达 13K。
    level = Math.floor(sorted[sorted.length - 1]!.level);
    hitCeiling = true;
  } else {
    // 在 [idx-1, idx] 两块之间线性插值到 p = 0.5。
    // 用块边界而非块内平均难度：保序回归把一段难度并成一块后，
    // 块内通过率恒定，真实跨越点位于前一块上界与后一块下界之间。
    const lo = mono[idx - 1]!;
    const hi = mono[idx]!;
    const loEdge = lo.high;   // 前一块的最大难度
    const hiEdge = hi.level;   // 后一块的最小难度
    const denom = lo.p - hi.p;
    const t = denom > 0 ? (lo.p - THRESHOLD) / denom : 0;
    level = loEdge + Math.min(1, Math.max(0, t)) * (hiEdge - loEdge);
  }

  const clamped = Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, level));
  return {
    level: clamped,
    rank: levelToRank(clamped),
    range: [levelToRank(clamped - 1), levelToRank(clamped + 1)],
    hitFloor,
    hitCeiling,
    described: totalN >= MIN_RATED_SAMPLES,
  };
}

/** 构造完整估算结果（补上样本数与置信度） */
function buildEstimate(fit: Omit<RankEstimate, 'sampleCount' | 'confidence'>, n: number): RankEstimate {
  return { ...fit, sampleCount: n, confidence: confidenceOf(n) };
}

/** 聚合同一组样本的通过率与难度桶 */
function aggregate(samples: Array<{ level: number; success: boolean }>): {
  buckets: Bucket[]; n: number; s: number; rate: number;
} {
  const map = new Map<number, Bucket>();
  let s = 0;
  for (const it of samples) {
    const b = map.get(it.level) ?? { level: it.level, n: 0, s: 0 };
    b.n += 1;
    if (it.success) { b.s += 1; s += 1; }
    map.set(it.level, b);
  }
  const n = samples.length;
  return { buckets: [...map.values()], n, s, rate: n > 0 ? s / n : 0 };
}

/** 生成点评：对比各题型棋力，点出最强/最弱项 */
function buildComment(overall: RankEstimate | null, byType: TypeStrength[]): string {
  if (!overall || !overall.described) {
    return '有效样本不足，多做一些带难度的题目后可给出棋力评估。';
  }
  const rated = byType
    .filter((t) => t.estimate && t.estimate.described && t.rated >= MIN_RATED_SAMPLES)
    .sort((a, b) => (b.estimate!.level) - (a.estimate!.level));
  if (rated.length < 2) {
    return `综合棋力约 ${overall.rank}，建议多做不同题型以看清强弱项。`;
  }
  const best = rated[0]!;
  const worst = rated[rated.length - 1]!;
  if (best.type === worst.type) {
    return `综合棋力约 ${overall.rank}。`;
  }
  const gap = best.estimate!.level - worst.estimate!.level;
  if (gap < 1.5) {
    return `综合棋力约 ${overall.rank}，各题型水平较为均衡。`;
  }
  return `综合棋力约 ${overall.rank}：${best.type}最强（${best.estimate!.rank}），${worst.type}偏弱（${worst.estimate!.rank}）。`;
}

/**
 * 生成完整统计报告
 * @param entries - 做题历史条目（全部历史）
 */
export function analyzeStrength(entries: PuzzleHistoryEntry[]): StrengthReport {
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();
  const weekStart = now - 7 * 24 * 60 * 60 * 1000;
  const monthStart = now - 30 * 24 * 60 * 60 * 1000;

  let success = 0;
  let durationSum = 0;
  let today = 0;
  let thisWeek = 0;
  let thisMonth = 0;

  // 题型统计（全部历史，不做有效性过滤，保证与题型分布口径一致）
  const typeMap = new Map<string, { count: number; correct: number }>();
  // 难度档分布
  const diffMap = new Map<string, { count: number; correct: number }>();
  // 有效样本（含难度 + 认真作答）
  const ratedSamples: Array<{ level: number; success: boolean; type: string }> = [];
  let rated = 0;
  let unrated = 0;

  for (const e of entries) {
    const ok = !!e.success;
    if (ok) success++;
    durationSum += e.duration ?? 0;
    const at = e.solvedAt ?? 0;
    if (at >= todayStartMs) today++;
    if (at >= weekStart) thisWeek++;
    if (at >= monthStart) thisMonth++;

    const type = parsePuzzleType(e.tag);
    const t = typeMap.get(type) ?? { count: 0, correct: 0 };
    t.count += 1;
    if (ok) t.correct += 1;
    typeMap.set(type, t);

    const level = parseDifficulty(e.tag);
    if (level !== null) {
      const label = level >= DAN_START ? '段位题' : '级位题';
      const d = diffMap.get(label) ?? { count: 0, correct: 0 };
      d.count += 1;
      if (ok) d.correct += 1;
      diffMap.set(label, d);
    }

    // 棋力评估样本：必须能解析难度且属于认真作答
    if (level !== null && isSeriousAttempt(e)) {
      ratedSamples.push({ level, success: ok, type });
      rated++;
    } else {
      unrated++;
    }
  }

  const total = entries.length;
  const globalN = ratedSamples.length;
  const globalS = ratedSamples.filter((x) => x.success).length;
  const globalRate = globalN > 0 ? globalS / globalN : 0;

  // 综合棋力：所有题一起拟合
  const overallAgg = aggregate(ratedSamples);
  const overall = globalN > 0
    ? buildEstimate(fitLevel(overallAgg.buckets, globalRate), globalN)
    : null;

  // 分题型棋力
  const byTypeMap = new Map<string, Array<{ level: number; success: boolean }>>();
  for (const s of ratedSamples) {
    const arr = byTypeMap.get(s.type) ?? [];
    arr.push({ level: s.level, success: s.success });
    byTypeMap.set(s.type, arr);
  }
  // 分题型：题数/正确率取全部历史口径，棋力仅用有效样本拟合
  const buildType = (type: string): TypeStrength => {
    const all = typeMap.get(type) ?? { count: 0, correct: 0 };
    const samples = byTypeMap.get(type) ?? [];
    const agg = aggregate(samples);
    return {
      type,
      count: all.count,
      correct: all.correct,
      rate: all.count > 0 ? all.correct / all.count : 0,
      rated: agg.n,
      estimate: agg.n > 0 ? buildEstimate(fitLevel(agg.buckets, globalRate), agg.n) : null,
    };
  };
  const byType: TypeStrength[] = PUZZLE_TYPES.map(buildType);
  // 其他类型（若有）追加在末尾
  if (typeMap.has(PUZZLE_TYPE_OTHER)) byType.push(buildType(PUZZLE_TYPE_OTHER));

  const typeDistribution = [...typeMap.entries()]
    .map(([label, v]) => ({ label, count: v.count, correct: v.correct, rate: v.count > 0 ? v.correct / v.count : 0 }))
    .sort((a, b) => b.count - a.count);

  // 难度档固定为「级位题 → 段位题」顺序
  const DIFFICULTY_ORDER = ['级位题', '段位题'];
  const difficultyDistribution = [...diffMap.entries()]
    .map(([label, v]) => ({ label, count: v.count, correct: v.correct, rate: v.count > 0 ? v.correct / v.count : 0 }))
    .sort((x, y) => DIFFICULTY_ORDER.indexOf(x.label) - DIFFICULTY_ORDER.indexOf(y.label));

  return {
    overall,
    byType,
    summary: {
      total,
      success,
      failed: total - success,
      rate: total > 0 ? success / total : 0,
      today,
      thisWeek,
      thisMonth,
      avgDuration: total > 0 ? Math.round(durationSum / total) : 0,
      rated,
      unrated,
    },
    typeDistribution,
    difficultyDistribution,
    comment: buildComment(overall, byType),
  };
}
