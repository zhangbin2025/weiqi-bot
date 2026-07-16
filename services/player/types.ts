/**
 * @fileoverview PlayerService 类型定义
 */

/**
 * 手谈等级分选手信息
 */
export interface ShoutanPlayer {
  /** 姓名 */
  name: string;
  /** 地区 */
  region: string;
  /** 段位称谓 */
  title: string;
  /** 等级分 */
  rating: number;
  /** 全国排名 */
  rank: number;
  /** 对局次数 */
  games: number;
  /** 详情链接 */
  detailUrl?: string;
}

/**
 * 手谈等级分查询结果
 */
export interface ShoutanResult {
  /** 是否找到 */
  found: boolean;
  /** 选手数量 */
  count: number;
  /** 选手列表 */
  players: ShoutanPlayer[];
  /** 错误信息 */
  error?: string;
}

/**
 * 易查分数据
 */
export interface YichafenData {
  /** 姓名 */
  name: string;
  /** 段位 */
  level: string;
  /** 等级分 */
  rating?: number;
  /** 总排名 */
  totalRank?: number;
  /** 省排名 */
  provinceRank?: number;
  /** 市排名 */
  cityRank?: number;
  /** 省份 */
  province?: string;
  /** 城市 */
  city?: string;
  /** 性别 */
  gender?: string;
  /** 出生年份 */
  birthYear?: number;
  /** 备注 */
  notes?: string;
}

/**
 * 易查分查询结果
 */
export interface YichafenResult {
  /** 是否找到 */
  found: boolean;
  /** 数据（第一个匹配结果） */
  data?: YichafenData;
  /** 所有匹配结果（模糊匹配时可能有多个同名棋手） */
  matches?: YichafenData[];
  /** 错误信息 */
  error?: string;
}

/**
 * 综合查询结果
 */
export interface PlayerQueryResult {
  /** 查询姓名 */
  name: string;
  /** 手谈等级分结果 */
  shoutan: ShoutanResult;
  /** 易查分结果 */
  yichafen: YichafenResult;
  /** 缓存时间 */
  cachedAt?: string;
}
