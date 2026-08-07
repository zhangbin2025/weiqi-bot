/**
 * 定式探索收藏管理器
 * @description 管理定式收藏的增删查改、导入导出、统计
 */
import type { IFavoriteService, IFavoriteItem } from '../../../services/favorite/IFavoriteService';
/** 收藏查询选项 */
export interface FavoriteQueryOptions {
  /** 关键词过滤 */
  keyword?: string;
  /** 数量限制 */
  limit?: number;
  /** 偏移量 */
  offset?: number;
}
/** 收藏条目 */
export interface FavoriteEntry {
  id: string;
  /** 定式路径 */
  path: string[];
  /** 创建时间 */
  createdAt: number;
  /** 备注 */
  note?: string;
}
/** 收藏统计 */
export interface FavoriteStats {
  total: number;
}
/**
 * 定式探索收藏管理器
 */
export class ExploreFavoritesManager {
  constructor(private readonly favoriteService?: IFavoriteService) {}
  /** 收藏定式 */
  async addFavorite(path: string[], note?: string): Promise<string> {
    if (!this.favoriteService) throw new Error('FavoriteService not available');
    const key = JSON.stringify(path);
    return this.favoriteService.addFavorite('joseki', key, undefined, note);
  }
  /** 查询收藏列表 */
  async queryFavorites(options?: FavoriteQueryOptions): Promise<FavoriteEntry[]> {
    if (!this.favoriteService) return [];
    const items = await this.favoriteService.getFavorites({ category: 'joseki' });
    let filtered = items;
    if (options?.keyword) {
      filtered = items.filter(item => item.note?.includes(options.keyword!));
    }
    const start = options?.offset ?? 0;
    const end = options?.limit ? start + options.limit : undefined;
    const sliced = filtered.slice(start, end);
    return sliced.map(item => this.transformFavoriteItem(item));
  }
  /** 删除收藏 */
  async removeFavorite(id: string): Promise<void> {
    if (!this.favoriteService) throw new Error('FavoriteService not available');
    await this.favoriteService.removeFavorite(id);
  }
  /** 导出收藏 */
  async exportFavorites(): Promise<string> {
    if (!this.favoriteService) return '[]';
    const items = await this.favoriteService.getFavorites({ category: 'joseki' });
    const entries = items.map(item => this.transformFavoriteItem(item));
    return JSON.stringify(entries, null, 2);
  }
  /** 导入收藏 */
  async importFavorites(json: string): Promise<number> {
    if (!this.favoriteService) throw new Error('FavoriteService not available');
    const entries: FavoriteEntry[] = JSON.parse(json);
    let count = 0;
    for (const entry of entries) {
      const key = JSON.stringify(entry.path);
      await this.favoriteService.addFavorite('joseki', key, undefined, entry.note);
      count++;
    }
    return count;
  }
  /** 清空收藏 */
  async clearFavorites(): Promise<void> {
    if (!this.favoriteService) throw new Error('FavoriteService not available');
    await this.favoriteService.clear('joseki');
  }
  /** 收藏统计 */
  async getFavoriteStats(): Promise<FavoriteStats> {
    if (!this.favoriteService) return { total: 0 };
    const total = await this.favoriteService.count('joseki');
    return { total };
  }
  /** 转换收藏条目 */
  private transformFavoriteItem(item: IFavoriteItem): FavoriteEntry {
    let path: string[] = [];
    try {
      path = JSON.parse(item.key);
    } catch {
      path = [];
    }
    const entry: FavoriteEntry = {
      id: item.id,
      path,
      createdAt: item.createdAt,
    };
    if (item.note !== undefined) {
      entry.note = item.note;
    }
    return entry;
  }
}
