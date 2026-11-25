/**
 * Token 消耗统计 —— 领域类型与业务常量
 * @module application/token/TokenUsageTypes
 *
 * 口径原则（项目铁律：每个数值都有清楚出处，不抄来路不明的经验值）：
 * - 每条记录 = 一次**成功返回 HTTP 2xx** 的 LLM 请求；token 数逐字来自端点
 *   响应体 usage，绝不本地按字符估算、绝不把估算值当消耗。
 * - 端点没返回 usage 时 token 记 0、reported=false，单独统计「未上报请求数」，
 *   不静默少算，也不拿别的值补。
 * - provider = new URL(baseUrl).host（标准 URL 解析）；完整端点另存字典供展开，
 *   不做映射表、不猜厂商名。
 * - 默认保留 30 天、可配范围 1~365 天：两者都是**明说的业务约束**
 *   （2026-11-25 需求「默认最多保留30天（可配置）」，上限一年便于年度回看），
 *   不是扫验证集挑出来的经验值。改口径改这里一行并写明理由。
 */

/** 默认保留天数 */
export const DEFAULT_TOKEN_RETENTION_DAYS = 30;
/** 允许的最小保留天数：至少留一天 */
export const MIN_TOKEN_RETENTION_DAYS = 1;
/** 允许的最大保留天数：一年 */
export const MAX_TOKEN_RETENTION_DAYS = 365;

/** 保留天数输入归一化：非法值回落默认，越界收敛到显式边界 */
export function normalizeRetentionDays(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TOKEN_RETENTION_DAYS;
  return Math.min(MAX_TOKEN_RETENTION_DAYS, Math.max(MIN_TOKEN_RETENTION_DAYS, Math.round(n)));
}

/** 统计时间段：自然日口径，含今日 */
export type TokenRangeId = 'today' | 'yesterday' | 'last7' | 'last30';

export const TOKEN_RANGE_LABELS: Readonly<Record<TokenRangeId, string>> = {
  today: '今日',
  yesterday: '昨日',
  last7: '最近 7 天',
  last30: '最近 30 天',
};

/**
 * 一次 LLM 请求的用量记录（内存/领域形状，未压缩）。
 * ts 是绝对毫秒时间戳；落盘时按自然日分片，并换算成日内偏移以压缩。
 */
export interface TokenUsageRecord {
  /** 请求完成时刻（设备本地时间） */
  ts: number;
  /** 原始 baseUrl 的 host；解析失败时回落 'unknown' */
  provider: string;
  /** buildChatCompletionsUrl(baseUrl) 的原始端点，不含代理改写 */
  endpoint: string;
  /** 请求体里实际使用的模型 ID */
  model: string;
  /** 调用用途：对话 / 标题 / 压缩 / 技能路由 / 意图识别 / 插件生成 */
  task: string;
  /** 端点上报的上行 token；未上报时为 0 */
  promptTokens: number;
  /** 端点上报的下行 token；未上报时为 0 */
  completionTokens: number;
  /** 端点上报的合计；缺省时 = 上行 + 下行 */
  totalTokens: number;
  /** 端点是否返回了 usage 对象 */
  reported: boolean;
}

/** 聚合后的一个分组行（provider / model / task / day 通用） */
export interface TokenGroupRow {
  key: string;
  requests: number;
  /** 该组中端点未上报用量的请求数 */
  unreported: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** 趋势里的一天 */
export interface TokenDayPoint {
  /** 本地自然日 YYYY-MM-DD */
  date: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** 一次查询的完整统计结果 */
export interface TokenStats {
  range: TokenRangeId;
  /** 查询涉及的起止自然日（含），用于文案与趋势补零 */
  fromDate: string;
  toDate: string;
  total: TokenGroupRow;
  byProvider: TokenGroupRow[];
  /** key = `${provider}\u0000${model}`；provider 前缀与 byProvider 对齐 */
  byModel: TokenGroupRow[];
  byTask: TokenGroupRow[];
  trend: TokenDayPoint[];
}
