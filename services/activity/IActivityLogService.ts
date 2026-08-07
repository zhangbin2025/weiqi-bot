/**
 * 活动日志服务接口
 * @description 记录用户操作历史（对弈、做题、查询等），支持丰富的查询条件
 */

/** 活动记录项 */
export interface ActivityEntry {
  /** 记录 ID */
  id: string;
  /** 活动类型 */
  type: string;
  /** 人可读标题 */
  title: string;
  /** 类型相关数据 */
  data: Record<string, unknown>;
  /** 标签（便于搜索） */
  tags?: (string | undefined)[];
  /** 创建时间 */
  createdAt: number;
}

/** 查询条件 */
export interface ActivityQuery {
  /** 类型过滤 */
  type?: string | undefined;
  /** 多类型过滤 */
  types?: (string | undefined)[];
  /** 关键词搜索（匹配 title 和 tags） */
  keyword?: string | undefined;
  /** 标签过滤 */
  tags?: (string | undefined)[];
  /** 时间范围 */
  startDate?: Date | undefined;
  endDate?: Date | undefined;
  /** 分页：数量限制 */
  limit?: number | undefined;
  /** 分页：偏移量 */
  offset?: number | undefined;
}

/** 统计结果 */
export interface ActivityStats {
  /** 总数 */
  total: number;
  /** 各类型数量 */
  byType: Record<string, number>;
  /** 今日数量 */
  today: number;
  /** 本周数量 */
  thisWeek: number;
  /** 本月数量 */
  thisMonth: number;
}

/** 活动类型常量 */
export const ActivityTypes = {
  PLAY: 'play',
  QUIZ: 'quiz',
  JOSEKI_DISCOVER: 'joseki_discover',
  PLAYER_QUERY: 'player_query',
  GAME_DOWNLOAD: 'game_download',
} as const;

/** 活动日志服务接口 */
export interface IActivityLogService {
  /**
   * 记录活动
   * @param type - 活动类型
   * @param title - 人可读标题
   * @param data - 类型相关数据
   * @param tags - 标签
   * @returns 记录 ID
   */
  record(type: string, title: string, data: Record<string, unknown>, tags?: string[]): Promise<string>;

  /**
   * 查询活动
   * @param filter - 查询条件
   * @returns 活动列表
   */
  query(filter?: ActivityQuery): Promise<ActivityEntry[]>;

  /**
   * 按 ID 查询
   * @param id - 记录 ID
   * @returns 活动记录或 null
   */
  getById(id: string): Promise<ActivityEntry | null>;

  /**
   * 统计信息
   * @returns 统计结果
   */
  stats(): Promise<ActivityStats>;

  /**
   * 统计数量
   * @param filter - 查询条件
   * @returns 数量
   */
  count(filter?: ActivityQuery): Promise<number>;

  /**
   * 清空活动记录
   * @param type - 指定类型清空（可选，不传则清空全部）
   */
  clear(type?: string): Promise<void>;

  /**
   * 初始化服务
   */
  initialize(): Promise<void>;
}
