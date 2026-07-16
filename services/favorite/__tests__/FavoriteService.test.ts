/**
 * FavoriteService 测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FavoriteService } from '../FavoriteService';
import type { IFavoriteItem } from '../IFavoriteService';
import type { IDocumentStorage, QueryCriteria } from '../../../infrastructure/storage/interfaces/IDocumentStorage';

/**
 * 内存文档存储适配器（仅用于测试）
 */
class MemoryDocumentStorage<T extends { id: string }> implements IDocumentStorage<T> {
  private items: Map<string, T> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async insert(doc: T): Promise<string> {
    this.items.set(doc.id, doc);
    return doc.id;
  }

  async insertMany(docs: T[]): Promise<string[]> {
    const ids: string[] = [];
    for (const doc of docs) {
      this.items.set(doc.id, doc);
      ids.push(doc.id);
    }
    return ids;
  }

  async update(id: string, doc: Partial<T>): Promise<void> {
    const existing = this.items.get(id);
    if (!existing) {
      throw new Error(`Document with id "${id}" not found`);
    }
    this.items.set(id, { ...existing, ...doc } as T);
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }

  async deleteMany(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.items.delete(id);
    }
  }

  async findById(id: string): Promise<T | null> {
    return this.items.get(id) ?? null;
  }

  async find(criteria?: QueryCriteria): Promise<T[]> {
    let results = Array.from(this.items.values());

    // 简单的 where 过滤
    if (criteria?.where) {
      results = results.filter(item => {
        for (const [key, value] of Object.entries(criteria.where!)) {
          if ((item as Record<string, unknown>)[key] !== value) {
            return false;
          }
        }
        return true;
      });
    }

    // 排序
    if (criteria?.orderBy) {
      const orderDir = criteria.orderDirection ?? 'asc';
      results.sort((a, b) => {
        const aVal = (a as Record<string, unknown>)[criteria.orderBy!];
        const bVal = (b as Record<string, unknown>)[criteria.orderBy!];
        if (aVal === undefined || bVal === undefined) return 0;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return orderDir === 'asc' ? aVal - bVal : bVal - aVal;
        }
        return 0;
      });
    }

    // 分页
    if (criteria?.offset) {
      results = results.slice(criteria.offset);
    }
    if (criteria?.limit) {
      results = results.slice(0, criteria.limit);
    }

    return results;
  }

  async findOne(criteria?: QueryCriteria): Promise<T | null> {
    const results = await this.find(criteria);
    return results[0] ?? null;
  }

  async count(criteria?: QueryCriteria): Promise<number> {
    const results = await this.find(criteria);
    return results.length;
  }

  async exists(id: string): Promise<boolean> {
    return this.items.has(id);
  }

  async clear(): Promise<void> {
    this.items.clear();
  }
}

describe('FavoriteService', () => {
  let storage: MemoryDocumentStorage<IFavoriteItem>;
  let service: FavoriteService;

  beforeEach(() => {
    storage = new MemoryDocumentStorage<IFavoriteItem>();
    service = new FavoriteService(storage);
  });

  describe('添加收藏', () => {
    it('应添加收藏并返回 ID', async () => {
      const id = await service.addFavorite('joseki', 'dd-pp-pd');
      expect(id).toBeDefined();
      expect(id.startsWith('favorites:joseki:')).toBe(true);
    });

    it('应添加不同分类的收藏', async () => {
      const id1 = await service.addFavorite('joseki', 'dd-pp');
      const id2 = await service.addFavorite('game', 'game-123');
      const id3 = await service.addFavorite('player', '柯洁');

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id3).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
    });

    it('应添加带额外数据的收藏', async () => {
      const data = { description: '小目定式', moves: ['dd', 'pp', 'pd'] };
      const id = await service.addFavorite('joseki', 'dd-pp-pd', data);

      const item = await service.getFavorite('joseki', 'dd-pp-pd');
      expect(item?.data).toEqual(data);
    });

    it('应添加带备注的收藏', async () => {
      const id = await service.addFavorite('joseki', 'dd-pp', undefined, '常用定式');

      const item = await service.getFavorite('joseki', 'dd-pp');
      expect(item?.note).toBe('常用定式');
    });

    it('重复添加应返回相同 ID', async () => {
      const id1 = await service.addFavorite('joseki', 'dd-pp');
      const id2 = await service.addFavorite('joseki', 'dd-pp');

      expect(id1).toBe(id2);
      expect(await service.count()).toBe(1);
    });
  });

  describe('获取收藏列表', () => {
    beforeEach(async () => {
      await service.addFavorite('joseki', 'dd-pp');
      await service.addFavorite('joseki', 'dd-qq');
      await service.addFavorite('game', 'game-123');
    });

    it('应获取所有收藏', async () => {
      const favorites = await service.getFavorites();
      expect(favorites).toHaveLength(3);
    });

    it('应按创建时间降序排列', async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      await service.addFavorite('player', '柯洁');

      const favorites = await service.getFavorites();
      expect(favorites[0].category).toBe('player');
    });
  });

  describe('查询过滤', () => {
    beforeEach(async () => {
      await service.addFavorite('joseki', 'dd-pp');
      await service.addFavorite('joseki', 'dd-qq');
      await service.addFavorite('game', 'game-123');
    });

    it('应按分类过滤', async () => {
      const favorites = await service.getFavorites({ category: 'joseki' });
      expect(favorites).toHaveLength(2);
      expect(favorites.every(f => f.category === 'joseki')).toBe(true);
    });

    it('应按键过滤', async () => {
      const favorites = await service.getFavorites({ key: 'dd-pp' });
      expect(favorites).toHaveLength(1);
      expect(favorites[0].key).toBe('dd-pp');
    });

    it('应按时间范围过滤', async () => {
      const now = Date.now();
      const yesterday = new Date(now - 86400000);
      const tomorrow = new Date(now + 86400000);

      const favorites = await service.getFavorites({
        startDate: yesterday,
        endDate: tomorrow,
      });
      expect(favorites).toHaveLength(3);
    });
  });

  describe('删除收藏', () => {
    it('应删除指定收藏', async () => {
      const id = await service.addFavorite('joseki', 'dd-pp');
      await service.removeFavorite(id);

      const item = await service.getFavorite('joseki', 'dd-pp');
      expect(item).toBeNull();
    });
  });

  describe('检查是否已收藏', () => {
    it('已收藏应返回 true', async () => {
      await service.addFavorite('joseki', 'dd-pp');
      const result = await service.isFavorited('joseki', 'dd-pp');
      expect(result).toBe(true);
    });

    it('未收藏应返回 false', async () => {
      const result = await service.isFavorited('joseki', 'nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('获取单个收藏', () => {
    it('应返回指定收藏', async () => {
      await service.addFavorite('joseki', 'dd-pp', { moves: 3 }, '测试定式');

      const item = await service.getFavorite('joseki', 'dd-pp');
      expect(item).toBeDefined();
      expect(item?.key).toBe('dd-pp');
      expect(item?.data?.moves).toBe(3);
      expect(item?.note).toBe('测试定式');
    });

    it('不存在应返回 null', async () => {
      const item = await service.getFavorite('joseki', 'nonexistent');
      expect(item).toBeNull();
    });
  });

  describe('更新备注', () => {
    it('应更新收藏备注', async () => {
      const id = await service.addFavorite('joseki', 'dd-pp');
      await service.updateNote(id, '更新后的备注');

      const item = await service.getFavorite('joseki', 'dd-pp');
      expect(item?.note).toBe('更新后的备注');
    });
  });

  describe('统计数量', () => {
    beforeEach(async () => {
      await service.addFavorite('joseki', 'dd-pp');
      await service.addFavorite('joseki', 'dd-qq');
      await service.addFavorite('game', 'game-123');
    });

    it('应统计全部收藏数量', async () => {
      const count = await service.count();
      expect(count).toBe(3);
    });

    it('应统计指定分类收藏数量', async () => {
      const count = await service.count('joseki');
      expect(count).toBe(2);
    });
  });

  describe('清空收藏', () => {
    beforeEach(async () => {
      await service.addFavorite('joseki', 'dd-pp');
      await service.addFavorite('joseki', 'dd-qq');
      await service.addFavorite('game', 'game-123');
    });

    it('应清空指定分类收藏', async () => {
      await service.clear('joseki');

      expect(await service.count('joseki')).toBe(0);
      expect(await service.count('game')).toBe(1);
    });

    it('应清空全部收藏', async () => {
      await service.clear();

      expect(await service.count()).toBe(0);
    });
  });
});
