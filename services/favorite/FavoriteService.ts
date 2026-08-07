import type { IFavoriteService, IFavoriteItem, FavoriteQuery } from './IFavoriteService';
import type { IDocumentStorage } from '../../infrastructure/storage/interfaces/IDocumentStorage';

/**
 * 收藏服务实现
 */
export class FavoriteService implements IFavoriteService {
  private readonly storage: IDocumentStorage<IFavoriteItem>;
  private readonly namespace: string;

  constructor(
    storage: IDocumentStorage<IFavoriteItem>,
    namespace: string = 'favorites'
  ) {
    this.storage = storage;
    this.namespace = namespace;
  }

  async addFavorite(
    category: string,
    key: string,
    data?: Record<string, unknown>,
    note?: string
  ): Promise<string> {
    // 检查是否已收藏
    const existing = await this.getFavorite(category, key);
    if (existing) {
      // 已存在，更新 data 和 createdAt（重新查询即更新）
      await this.storage.update(existing.id, {
        data,
        createdAt: Date.now(),
        ...(note !== undefined && { note }),
      });
      return existing.id;
    }

    const id = `${this.namespace}:${category}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const item: IFavoriteItem = {
      id,
      category,
      key,
      data,
      createdAt: Date.now(),
      note,
    };

    await this.storage.insert(item);
    return id;
  }

  async getFavorites(query?: FavoriteQuery): Promise<IFavoriteItem[]> {
    const where: Record<string, unknown> = {};

    if (query?.category) {
      where['category'] = query['category'];
    }
    if (query?.key) {
      where['key'] = query['key'];
    }

    // 时间范围过滤需要在内存中处理（IDocumentStorage 可能不支持复杂查询）
    let results = await this.storage.find({ where, orderBy: 'createdAt', orderDirection: 'desc' });

    if (query?.startDate || query?.endDate) {
      results = results.filter(item => {
        if (query.startDate && item.createdAt < query.startDate.getTime()) return false;
        if (query.endDate && item.createdAt > query.endDate.getTime()) return false;
        return true;
      });
    }

    return results;
  }

  async removeFavorite(id: string): Promise<void> {
    await this.storage.delete(id);
  }

  async isFavorited(category: string, key: string): Promise<boolean> {
    const item = await this.getFavorite(category, key);
    return item !== null;
  }

  async getFavorite(category: string, key: string): Promise<IFavoriteItem | null> {
    const results = await this.storage.find({
      where: { category, key },
    });
    return results[0] ?? null;
  }

  async getById(id: string): Promise<IFavoriteItem | null> {
    return await this.storage.findById(id);
  }

  async updateNote(id: string, note: string): Promise<void> {
    await this.storage.update(id, { note });
  }

  async count(category?: string): Promise<number> {
    if (category) {
      return await this.storage.count({ where: { category } });
    }
    return await this.storage.count();
  }

  async clear(category?: string): Promise<void> {
    if (category) {
      const items = await this.storage.find({ where: { category } });
      await this.storage.deleteMany(items.map(i => i.id));
    } else {
      await this.storage.clear();
    }
  }
}
