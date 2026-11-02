/**
 * @fileoverview 形势统计计算（纯函数，可单测）
 *
 * @description 从 KataGo 的 ownership 数组算出黑白目数与领先关系。
 * 不依赖 DOM、不依赖引擎，便于单元测试覆盖边界情况。
 *
 * ownership 约定（已核实，见 analyzeMcts.ts:390）：
 * - 长度 = boardSize²，索引 = y * size + x
 * - 值域 [-1, 1]，符号**绝对黑方视角**：+1 黑领地，-1 白领地
 * - 不随行棋方翻转（mm 双 AI 对局亦然）
 */

/** 目数显示的小数位 */
const SCORE_DECIMALS = 1;

export interface TerritoryStatsInput {
  /** 领地归属，长度 = size² */
  ownership: Float32Array | number[];
  /** 棋盘边长 */
  boardSize: number;
  /** 黑方提子数（黑提掉对方的子，非负） */
  capturedBlack: number;
  /** 白方提子数 */
  capturedWhite: number;
  /** 贴目（黑方需贴给白方的目数） */
  komi: number;
}

export interface TerritoryStats {
  /** 黑方目数（领地和，含死子折算） */
  blackTerritory: number;
  /** 白方目数 */
  whiteTerritory: number;
  /** 黑方提子数 */
  capturedBlack: number;
  /** 白方提子数 */
  capturedWhite: number;
  /** 贴目 */
  komi: number;
  /** 目数差（黑 − 白，未扣贴目） */
  rawDiff: number;
  /** 扣贴目后的最终领先（黑视角，正数表示黑领先） */
  finalLead: number;
  /** 领先方 */
  leader: 'black' | 'white' | 'even';
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * 由 ownership 计算黑白目数
 *
 * @description 用正部和 / 负部和分别累加，天然处理死子：
 * 被判为对方领地的棋子，其 ownership 为负（对黑子而言），不会计入黑目。
 * 这与棋盘绘制（|v| >= 0.5 才画）是两套判据 —— 统计用连续求和更平滑，
 * 绘制用阈值避免画出大量半透明的未定区域。
 */
function sumTerritory(ownership: Float32Array | number[], boardSize: number): { black: number; white: number } {
  let black = 0;
  let white = 0;
  const n = boardSize * boardSize;
  for (let i = 0; i < n; i++) {
    const v = ownership[i] ?? 0;
    if (v > 0) black += v;
    else white += -v;
  }
  return { black, white };
}

/**
 * 计算形势统计
 *
 * @param input - ownership、提子数、贴目
 * @returns 统计结果；ownership 无效（长度不符 / 缺失）时返回 null，
 *          调用方可据此提示「未能获取形势数据」
 */
export function computeTerritoryStats(input: TerritoryStatsInput): TerritoryStats | null {
  const { ownership, boardSize, capturedBlack, capturedWhite, komi } = input;

  if (!ownership) return null;
  const expected = boardSize * boardSize;
  if (boardSize <= 0 || ownership.length < expected) return null;

  const { black, white } = sumTerritory(ownership, boardSize);
  const blackTerritory = round1(black);
  const whiteTerritory = round1(white);

  // 目数差：黑目 − 白目。提子在中国规则（数子法）下已反映在领地里，
  // 这里只做展示，不参与差值的加减（与 KataGo scoreLead 语义一致）。
  const rawDiff = round1(blackTerritory - whiteTerritory);
  const finalLead = round1(rawDiff - komi);

  let leader: 'black' | 'white' | 'even';
  if (finalLead > 0) leader = 'black';
  else if (finalLead < 0) leader = 'white';
  else leader = 'even';

  return {
    blackTerritory,
    whiteTerritory,
    capturedBlack: capturedBlack ?? 0,
    capturedWhite: capturedWhite ?? 0,
    komi,
    rawDiff,
    finalLead,
    leader,
  };
}

/**
 * 格式化领先文案
 * @returns 例如「黑领先 7.5 目」「白领先 2.5 目」「双方持平」
 */
export function formatLead(stats: TerritoryStats): string {
  if (stats.leader === 'even') return '双方持平';
  const who = stats.leader === 'black' ? '黑' : '白';
  return `${who}领先 ${Math.abs(stats.finalLead).toFixed(SCORE_DECIMALS)} 目`;
}

/**
 * 格式化提子文案：只显示非零方，避免 0 时的噪音
 * @returns 例如「提 3」
 */
export function formatCaptures(count: number): string {
  return `提 ${count}`;
}

/**
 * 形势专用 visits：按模型规模分档，目的是「快」而非「准」
 *
 * @description 形势判断只看领地归属，比选点粗得多，不需要高 visits。
 * 大模型每次 visit 的算力成本远高于小模型，故档位差距较大。
 *
 * 分档（与 ReviewUI.getAnalysisVisitsForModel 保持同样的判定模式：
 * blocks 优先，URL 正则兜底）：
 * - 小/中模型（blocks <= 10）→ 20
 * - 大模型（blocks > 10）     → 10
 *
 * 用户决策（2026-11-02）：业界看形势普遍不追求精度，要的是响应速度。
 */
export const TERRITORY_VISITS_SMALL_MODEL = 20;
export const TERRITORY_VISITS_LARGE_MODEL = 10;
/** 无法判定模型规模时的保守值（取小模型档，保证有足够搜索量） */
export const TERRITORY_VISITS_FALLBACK = 20;

/**
 * 按模型规模给出形势分析用的 visits
 *
 * @param model - 模型配置（可含 blocks / url 字段）；为空时用兜底值
 */
export function territoryVisitsForModel(model: unknown): number {
  const m = model as { blocks?: number; url?: string } | null | undefined;
  const blocks = m?.blocks ?? 0;
  if (blocks > 0) {
    return blocks > 10 ? TERRITORY_VISITS_LARGE_MODEL : TERRITORY_VISITS_SMALL_MODEL;
  }
  // blocks 缺失：从 URL/文件名解析（如 g170-b10c128 → 10，kata1-b18c384nbt → 18）
  const url = m?.url ?? '';
  const match = /b(\d+)c/i.exec(url);
  if (match) {
    const b = parseInt(match[1]!, 10);
    return b > 10 ? TERRITORY_VISITS_LARGE_MODEL : TERRITORY_VISITS_SMALL_MODEL;
  }
  return TERRITORY_VISITS_FALLBACK;
}
