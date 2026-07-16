/**
 * @fileoverview EventService 类型定义（赛事服务）
 * @description 云比赛网查询服务的输入输出类型
 */

/**
 * 比赛查询选项
 */
export interface EventQueryOptions {
  /** 地区名称（如：广东省） */
  area?: string;
  /** 最近多少个月 */
  month?: number;
  /** 关键词过滤 */
  keyword?: string;
  /** 每页数量（最大 200） */
  pageSize?: number;
}

/**
 * 比赛信息
 */
export interface Event {
  /** 比赛ID */
  id: number;
  /** 比赛名称 */
  title: string;
  /** 城市 */
  city: string;
  /** 比赛日期 */
  date: string | null;
  /** 参赛人数 */
  players: number;
}

/**
 * 比赛列表结果
 */
export interface EventListResult {
  /** 比赛列表 */
  events: Event[];
  /** 总数量 */
  total: number;
}

/**
 * 分组信息
 */
export interface Group {
  /** 分组ID */
  id: number;
  /** 分组名称 */
  name: string;
  /** 参赛人数 */
  players: number | null;
}

/**
 * 分组列表结果
 */
export interface GroupListResult {
  /** 分组列表 */
  groups: Group[];
  /** 总数量 */
  total: number;
  /** 数据来源 */
  source: 'api' | 'html' | 'error';
  /** 错误信息 */
  error?: string;
}

/**
 * 选手信息
 */
export interface Player {
  /** 选手ID */
  id: number;
  /** 姓名 */
  name: string;
  /** 段位/级别 */
  rank?: string;
  /** 积分 */
  score?: number;
}

/**
 * 选手列表结果
 */
export interface PlayerListResult {
  /** 选手列表 */
  players: Player[];
  /** 总数量 */
  total: number;
}

/**
 * 对局信息
 */
export interface Match {
  /** 轮次 */
  bout: number;
  /** 黑方ID */
  p1Id: number;
  /** 黑方姓名 */
  p1Name: string;
  /** 黑方得分 */
  p1Score: number;
  /** 白方ID */
  p2Id: number;
  /** 白方姓名 */
  p2Name: string;
  /** 白方得分 */
  p2Score: number;
}

/**
 * 单轮对阵结果
 */
export interface AgainstPlanResult {
  /** 对局列表 */
  rows: Match[];
  /** 总轮数 */
  totalBout: number;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

/**
 * 所有轮次对阵结果
 */
export interface AllRoundsResult {
  /** 所有对局 */
  matches: Match[];
  /** 总轮数 */
  totalRounds: number;
  /** 已完成轮数 */
  completedRounds: number;
}

/**
 * 进度回调函数
 */
export type ProgressCallback = (message: string, percent: number) => void;
