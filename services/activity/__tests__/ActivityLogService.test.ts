import { describe, it, expect, beforeEach } from 'vitest';
import { ActivityLogService, ActivityTypes } from '../index';
import type { IDocumentStorage } from '../../../infrastructure/storage/interfaces/IDocumentStorage';
import type { ActivityEntry } from '../IActivityLogService';

/** 内存存储模拟实现 */
class MockStorage implements IDocumentStorage<ActivityEntry> {
  private data: Map<string, ActivityEntry> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async insert(doc: ActivityEntry): Promise<string> {
    this.data.set(doc.id, doc);
    return doc.id;
  }

  async insertMany(docs: ActivityEntry[]): Promise<string[]> {
    return Promise.all(docs.map(doc => this.insert(doc)));
  }

  async update(id: string, doc: Partial<ActivityEntry>): Promise<void> {
    const existing = this.data.get(id);
    if (existing) {
      this.data.set(id, { ...existing, ...doc });
    }
  }

  async delete(id: string): Promise<void> {
    this.data.delete(id);
  }

  async deleteMany(ids: string[]): Promise<void> {
    ids.forEach(id => this.data.delete(id));
  }

  async findById(id: string): Promise<ActivityEntry | null> {
    return this.data.get(id) ?? null;
  }

  async find(criteria?: { where?: Record<string, unknown>; orderBy?: string; orderDirection?: 'asc' | 'desc' }): Promise<ActivityEntry[]> {
    let results = Array.from(this.data.values());

    if (criteria?.where) {
      results = results.filter(item => {
        return Object.entries(criteria.where!).every(([key, value]) => item[key as keyof ActivityEntry] === value);
      });
    }

    if (criteria?.orderBy) {
      const field = criteria.orderBy as keyof ActivityEntry;
      results.sort((a, b) => {
        const aVal = a[field];
        const bVal = b[field];
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return criteria.orderDirection === 'desc' ? bVal - aVal : aVal - bVal;
        }
        return 0;
      });
    }

    return results;
  }

  async findOne(): Promise<ActivityEntry | null> {
    return Array.from(this.data.values())[0] ?? null;
  }

  async count(): Promise<number> {
    return this.data.size;
  }

  async exists(id: string): Promise<boolean> {
    return this.data.has(id);
  }

  async clear(): Promise<void> {
    this.data.clear();
  }
}

describe('ActivityLogService', () => {
  let service: ActivityLogService;
  let storage: MockStorage;

  beforeEach(async () => {
    storage = new MockStorage();
    service = new ActivityLogService(storage);
    await service.initialize();
  });

  describe('初始化', () => {
    it('应该成功初始化服务', async () => {
      await expect(service.initialize()).resolves.not.toThrow();
    });
  });

  describe('记录活动', () => {
    it('应该记录对弈活动', async () => {
      const id = await service.record(ActivityTypes.PLAY, '对战柯洁', { opponent: '柯洁', result: '胜' }, ['九段', '友谊赛']);
      expect(id).toMatch(/^act:\d+:[a-z0-9]+$/);
    });

    it('应该记录做题活动', async () => {
      const id = await service.record(ActivityTypes.QUIZ, '死活题 #123', { quizId: '123', solved: true });
      expect(id).toBeDefined();
    });

    it('应该记录不同类型的活动', async () => {
      await service.record(ActivityTypes.PLAY, '对战1', {});
      await service.record(ActivityTypes.QUIZ, '做题1', {});
      await service.record(ActivityTypes.JOSEKI_DISCOVER, '定式探索', {});
      await service.record(ActivityTypes.PLAYER_QUERY, '查询棋手', {});
      await service.record(ActivityTypes.GAME_DOWNLOAD, '下载棋谱', {});

      const all = await service.query();
      expect(all).toHaveLength(5);
    });
  });

  describe('查询活动', () => {
    beforeEach(async () => {
      await service.record(ActivityTypes.PLAY, '对战柯洁', { result: '胜' }, ['九段']);
      await service.record(ActivityTypes.PLAY, '对战申真谞', { result: '负' }, ['九段', '世界冠军']);
      await service.record(ActivityTypes.QUIZ, '死活题训练', { solved: true }, ['入门']);
    });

    it('应该查询全部活动', async () => {
      const results = await service.query();
      expect(results).toHaveLength(3);
    });

    it('应该按类型查询', async () => {
      const results = await service.query({ type: ActivityTypes.PLAY });
      expect(results).toHaveLength(2);
      expect(results.every(r => r.type === ActivityTypes.PLAY)).toBe(true);
    });

    it('应该按多类型查询', async () => {
      const results = await service.query({ types: [ActivityTypes.PLAY, ActivityTypes.QUIZ] });
      expect(results).toHaveLength(3);
    });

    it('应该按关键词搜索（匹配 title）', async () => {
      const results = await service.query({ keyword: '柯洁' });
      expect(results).toHaveLength(1);
      expect(results[0].title).toContain('柯洁');
    });

    it('应该按关键词搜索（匹配 tags）', async () => {
      const results = await service.query({ keyword: '九段' });
      expect(results).toHaveLength(2);
    });

    it('应该按标签过滤', async () => {
      const results = await service.query({ tags: ['世界冠军'] });
      expect(results).toHaveLength(1);
      expect(results[0].title).toContain('申真谞');
    });

    it('应该按时间范围过滤', async () => {
      const now = Date.now();
      const yesterday = new Date(now - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now + 24 * 60 * 60 * 1000);

      const results = await service.query({ startDate: yesterday, endDate: tomorrow });
      expect(results).toHaveLength(3);
    });

    it('应该支持分页查询', async () => {
      const page1 = await service.query({ limit: 2 });
      expect(page1).toHaveLength(2);

      const page2 = await service.query({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(1);
    });

    it('应该按时间倒序排列', async () => {
      const results = await service.query();
      expect(results[0].createdAt).toBeGreaterThanOrEqual(results[1].createdAt);
    });
  });

  describe('按 ID 查询', () => {
    it('应该按 ID 查询活动', async () => {
      const id = await service.record(ActivityTypes.PLAY, '测试对战', {});
      const result = await service.getById(id);
      expect(result).not.toBeNull();
      expect(result?.title).toBe('测试对战');
    });

    it('应该返回 null 如果 ID 不存在', async () => {
      const result = await service.getById('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('统计信息', () => {
    beforeEach(async () => {
      await service.record(ActivityTypes.PLAY, '对战1', {});
      await service.record(ActivityTypes.PLAY, '对战2', {});
      await service.record(ActivityTypes.QUIZ, '做题1', {});
    });

    it('应该返回统计信息', async () => {
      const stats = await service.stats();
      expect(stats.total).toBe(3);
      expect(stats.byType[ActivityTypes.PLAY]).toBe(2);
      expect(stats.byType[ActivityTypes.QUIZ]).toBe(1);
      expect(stats.today).toBe(3);
      expect(stats.thisWeek).toBe(3);
      expect(stats.thisMonth).toBe(3);
    });
  });

  describe('统计数量', () => {
    beforeEach(async () => {
      await service.record(ActivityTypes.PLAY, '对战1', {});
      await service.record(ActivityTypes.QUIZ, '做题1', {});
    });

    it('应该统计总数', async () => {
      const count = await service.count();
      expect(count).toBe(2);
    });

    it('应该按条件统计', async () => {
      const count = await service.count({ type: ActivityTypes.PLAY });
      expect(count).toBe(1);
    });
  });

  describe('清空记录', () => {
    beforeEach(async () => {
      await service.record(ActivityTypes.PLAY, '对战1', {});
      await service.record(ActivityTypes.PLAY, '对战2', {});
      await service.record(ActivityTypes.QUIZ, '做题1', {});
    });

    it('应该清空指定类型', async () => {
      await service.clear(ActivityTypes.QUIZ);
      const remaining = await service.query();
      expect(remaining).toHaveLength(2);
      expect(remaining.every(r => r.type === ActivityTypes.PLAY)).toBe(true);
    });

    it('应该清空全部', async () => {
      await service.clear();
      const remaining = await service.query();
      expect(remaining).toHaveLength(0);
    });
  });
});
