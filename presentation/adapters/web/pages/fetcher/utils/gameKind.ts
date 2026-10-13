/**
 * 棋谱分类器
 * @module presentation/pages/fetcher/utils/gameKind
 * @description
 * fetcher 是棋谱来源的唯一入口：棋谱下载下来后，根据棋谱类别决定「后续可以做什么」。
 * 本模块是唯一事实来源，结果卡片 / 最新列表 / 收藏列表 / 后台任务通知都从这里取能力集。
 *
 * 四类棋谱（判定短路顺序即优先级）：
 *   1. puzzle     死活题棋谱       → 做题优先
 *   2. live       未结束实战棋谱   → 直播优先
 *   3. ai-review  带 AI 标注棋谱   → 实战选点优先
 *   4. plain      一般棋谱         → 打谱（查看）优先
 */

/** 棋谱类别 */
export type GameKind = 'puzzle' | 'live' | 'ai-review' | 'plain';

/** 扩展动作 */
export type GameAction =
  | 'download'   // 下载 SGF
  | 'view'       // 打谱
  | 'share'      // 分享二维码
  | 'live'       // 直播
  | 'puzzle'     // 做题
  | 'review'     // 复盘（本地模型）
  | 'decision'   // 实战选点
  | 'joseki'     // 发现定式
  | 'viewUrl';   // 查看原始链接

/** 分类判定输入 */
export interface ClassifyInput {
  /** 来源标识 */
  source: string;
  /** 原始 URL */
  url?: string | undefined;
  /** 是否直播（metadata.isLive） */
  isLive?: boolean | undefined;
  /** 对局是否已结束（metadata.isEnded） */
  isEnded?: boolean | undefined;
  /** 外部可打开链接（缺省回退 url） */
  externalUrl?: string | undefined;
  /** SGF 内容（可选；提供则用于识别 AI 标注） */
  sgf?: string | undefined;
}

/** 分类结果 */
export interface GameClassification {
  /** 棋谱类别 */
  kind: GameKind;
  /** 全部可用动作（顺序即菜单展示顺序） */
  actions: GameAction[];
  /** 首要动作：结果卡片默认按钮、后台任务通知主链接都用它 */
  primary: GameAction;
}

/** 死活题来源 */
const PUZZLE_SOURCES = new Set(['lib-life-death', 'goproblems', 'ogs-puzzle']);

/** 101 围棋题目页 URL 模式 */
const WEIQI101_PUZZLE_PATTERNS = [
  /101weiqi\.com\/qday\//i,
  /101weiqi\.com\/q\//i,
  /101weiqi\.cn\/qday\//i,
  /101weiqi\.cn\/q\//i,
];

/** 直播来源（未结束实战棋谱） */
const LIVE_SOURCES = new Set(['ogs-live', 'yike-live']);

/** 内置库 AI review 来源 */
const LIB_AI_REVIEW_SOURCE = 'lib-ai-review';

/**
 * SGF 中 AI 标注的模式
 * @description 覆盖三类带 AI review 的棋谱：
 *   - 野狐绝艺：`C[jueyi黑53.2%]`（也兼容无 jueyi 前缀的 `黑53.2%`）
 *   - OGS AI review：`C[胜率: 36.1% | 目差: -0.9 | 第1手]` 或头部 `C[AI: KataGo | ... | Final WR: 51.2%]`
 *   - KataGo Archive：`C[0.51 0.49 0.00 0.6 v=600]`
 */
const AI_ANNOTATION_PATTERNS: RegExp[] = [
  /jueyi(?:黑|白)\d+(?:\.\d+)?%/i,           // 野狐绝艺
  /(?:黑|白)\d+(?:\.\d+)?%/,                  // 野狐（无前缀）
  /胜率[:\s]*\d+(?:\.\d+)?%/i,                // OGS 每手胜率
  /C\[AI:[^\]]*Final WR:/i,                   // OGS 头部 AI 元信息
  /C\[\d+\.?\d* \d+\.?\d* [-\d.]+ [-\d.]+ v=\d+/, // KataGo Archive
];

/** 是否为死活题棋谱 */
export function isPuzzleGame(source: string, url?: string): boolean {
  if (PUZZLE_SOURCES.has(source)) return true;
  if (source === 'weiqi101' && url) {
    return WEIQI101_PUZZLE_PATTERNS.some((p) => p.test(url));
  }
  return false;
}

/**
 * 是否为未结束的实战棋谱（可直播）
 * @description 优先用 isLive / isEnded 实况标记；缺省时回退按来源判断
 */
export function isLiveGame(source: string, isLive?: boolean, isEnded?: boolean): boolean {
  if (isLive === true) return true;
  if (isEnded === false) return true;
  if (isLive === false || isEnded === true) return false;
  return LIVE_SOURCES.has(source);
}

/**
 * 检测 SGF 是否含 AI 分析标注
 * @param sgf SGF 内容；只扫描前 32KB 即可（绝艺/OGS 的注释分散在全篇，但开头必有）
 */
export function hasAiAnnotation(sgf?: string): boolean {
  if (!sgf) return false;
  const head = sgf.length > 32768 ? sgf.slice(0, 32768) : sgf;
  return AI_ANNOTATION_PATTERNS.some((p) => p.test(head));
}

/** 是否为带 AI review 的棋谱 */
export function isAiReviewGame(source: string, sgf?: string): boolean {
  if (source === LIB_AI_REVIEW_SOURCE) return true;
  return hasAiAnnotation(sgf);
}

/**
 * 分类棋谱
 * @description 短路顺序：死活题 → 未结束实战 → 带 AI 标注 → 一般棋谱
 */
export function classifyGame(input: ClassifyInput): GameClassification {
  const { source, url, isLive, isEnded, sgf } = input;

  // 1. 死活题：做题优先
  if (isPuzzleGame(source, url)) {
    return {
      kind: 'puzzle',
      primary: 'puzzle',
      actions: ['puzzle', 'view', 'review', 'download', 'share'],
    };
  }

  // 2. 未结束实战：直播优先
  if (isLiveGame(source, isLive, isEnded)) {
    return {
      kind: 'live',
      primary: 'live',
      actions: ['live', 'view', 'joseki', 'download', 'share'],
    };
  }

  // 3. 带 AI 标注：实战选点优先
  if (isAiReviewGame(source, sgf)) {
    return {
      kind: 'ai-review',
      primary: 'decision',
      actions: ['decision', 'view', 'review', 'joseki', 'download', 'share'],
    };
  }

  // 4. 一般棋谱：打谱优先
  return {
    kind: 'plain',
    primary: 'view',
    actions: ['view', 'review', 'joseki', 'download', 'share'],
  };
}

/** 动作元数据（图标 + 文案 + 是否危险色） */
const ACTION_META: Record<GameAction, { icon: string; label: string; danger?: boolean }> = {
  download: { icon: '📥', label: '下载' },
  view: { icon: '👁️', label: '查看' },
  share: { icon: '📱', label: '分享' },
  live: { icon: '🔴', label: '直播', danger: true },
  puzzle: { icon: '🧩', label: '做题', danger: true },
  review: { icon: '🔍', label: '复盘' },
  decision: { icon: '🎯', label: '实战选点', danger: true },
  joseki: { icon: '📐', label: '发现定式' },
  viewUrl: { icon: '🔗', label: '查看链接' },
};

/** 取动作展示文案（含图标） */
export function actionLabel(action: GameAction): string {
  const m = ACTION_META[action];
  return m.icon + ' ' + m.label;
}

/** 取动作图标 */
export function actionIcon(action: GameAction): string {
  return ACTION_META[action].icon;
}

/** 取动作纯文案（不含图标） */
export function actionText(action: GameAction): string {
  return ACTION_META[action].label;
}

/** 是否为强调色动作（首要动作常用） */
export function isDangerAction(action: GameAction): boolean {
  return ACTION_META[action].danger === true;
}
