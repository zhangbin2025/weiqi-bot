/**
 * 收藏项接口
 */
export interface IFavoriteItem {
  /** 收藏 ID */
  id: string;
  /** 收藏分类（joseki/game/player 等） */
  category: string;
  /** 收藏项唯一标识（如定式路径、棋谱ID、棋手名） */
  key: string;
  /** 收藏项数据（可选，存储额外信息） */
  data?: Record<string, unknown> | undefined;
  /** 创建时间 */
  createdAt: number;
  /** 备注（可选） */
  note?: string | undefined;
}

/**
 * 收藏查询条件
 */
export interface FavoriteQuery {
  /** 分类过滤 */
  category?: string;
  /** 键过滤 */
  key?: string;
  /** 时间范围 */
  startDate?: Date;
  endDate?: Date;
}

/**
 * 收藏服务接口
 */
export interface IFavoriteService {
  /**
   * 添加收藏
   * @param category - 分类
   * @param key - 收藏项标识
   * @param data - 额外数据（可选）
   * @param note - 备注（可选）
   * @returns 收藏 ID
   */
  addFavorite(category: string, key: string, data?: Record<string, unknown>, note?: string): Promise<string>;

  /**
   * 获取收藏列表
   * @param query - 查询条件
   * @returns 收藏列表
   */
  getFavorites(query?: FavoriteQuery): Promise<IFavoriteItem[]>;

  /**
   * 删除收藏
   * @param id - 收藏 ID
   */
  removeFavorite(id: string): Promise<void>;

  /**
   * 检查是否已收藏
   * @param category - 分类
   * @param key - 收藏项标识
   * @returns 是否已收藏
   */
  isFavorited(category: string, key: string): Promise<boolean>;

  /**
   * 获取单个收藏
   * @param category - 分类
   * @param key - 收藏项标识
   * @returns 收藏项或 null
   */
  getFavorite(category: string, key: string): Promise<IFavoriteItem | null>;

  /**
   * 通过 ID 获取收藏
   * @param id - 收藏 ID
   * @returns 收藏项或 null
   */
  getById(id: string): Promise<IFavoriteItem | null>;

  /**
   * 更新收藏备注
   * @param id - 收藏 ID
   * @param note - 新备注
   */
  updateNote(id: string, note: string): Promise<void>;

  /**
   * 统计收藏数量
   * @param category - 分类（可选，不传则统计全部）
   * @returns 收藏数量
   */
  count(category?: string): Promise<number>;

  /**
   * 清空收藏
   * @param category - 分类（可选，不传则清空全部）
   */
  clear(category?: string): Promise<void>;

}
