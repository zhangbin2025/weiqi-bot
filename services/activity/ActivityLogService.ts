import type { IActivityLogService, ActivityEntry, ActivityQuery, ActivityStats } from './IActivityLogService';
import type { IDocumentStorage } from '../../infrastructure/storage/interfaces/IDocumentStorage';
import type { IConfigProvider } from '../../infrastructure/config/interfaces/IConfigProvider';
import type { IActivityConfig } from '../../infrastructure/config/schemas/ActivityConfigSchema';
import { ActivityConfigSchema } from '../../infrastructure/config/schemas/ActivityConfigSchema';

/**
 * 活动日志服务实现
 * @description 记录用户操作历史，支持丰富的查询条件
 */
export class ActivityLogService implements IActivityLogService {
  private readonly storage: IDocumentStorage<ActivityEntry>;
  private readonly configProvider: IConfigProvider | null;
  private config: IActivityConfig = ActivityConfigSchema;

  constructor(storage: IDocumentStorage<ActivityEntry>, configProvider?: IConfigProvider) {
    this.storage = storage;
    this.configProvider = configProvider ?? null;
  }

  async initialize(): Promise<void> {
    // 加载配置
    if (this.configProvider) {
      this.config = await this.configProvider.getModuleConfig<IActivityConfig>('activity');
    }
    await this.storage.initialize();
  }

  async record(type: string, title: string, data: Record<string, unknown>, tags?: string[]): Promise<string> {
    const id = `act:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const entry: ActivityEntry = {
      id,
      type,
      title,
      data,
      ...(tags ? { tags } : {}),
      createdAt: Date.now(),
    };
    await this.storage.insert(entry);
    return id;
  }

  async query(filter?: ActivityQuery): Promise<ActivityEntry[]> {
    // 构建 where 条件
    const where: Record<string, unknown> = {};
    if (filter?.['type']) where['type'] = filter['type'];

    let results = await this.storage.find({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: 'createdAt',
      orderDirection: 'desc',
    });

    // 内存过滤（IDocumentStorage 可能不支持复杂查询）
    results = results.filter(entry => {
      // 多类型过滤
      if (filter?.types && filter.types.length > 0) {
        if (!filter.types.includes(entry.type)) return false;
      }

      // 关键词搜索（匹配 title 和 tags）
      if (filter?.keyword) {
        const kw = filter.keyword.toLowerCase();
        const titleMatch = entry.title.toLowerCase().includes(kw);
        const tagMatch = entry.tags?.some((t: string | undefined) => t?.toLowerCase().includes(kw) ?? false) ?? false;
        if (!titleMatch && !tagMatch) return false;
      }

      // 标签过滤
      if (filter?.tags && filter.tags.length > 0) {
        const hasTag = filter.tags.some(t => entry.tags?.includes(t));
        if (!hasTag) return false;
      }

      // 时间范围
      if (filter?.startDate && entry.createdAt < filter.startDate.getTime()) return false;
      if (filter?.endDate && entry.createdAt > filter.endDate.getTime()) return false;

      return true;
    });

    // 分页
    if (filter?.offset) {
      results = results.slice(filter.offset);
    }
    if (filter?.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  async getById(id: string): Promise<ActivityEntry | null> {
    return await this.storage.findById(id);
  }

  async stats(): Promise<ActivityStats> {
    const all = await this.storage.find();
    const now = Date.now();
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    const weekStart = now - 7 * 24 * 60 * 60 * 1000;
    const monthStart = now - 30 * 24 * 60 * 60 * 1000;

    const byType: Record<string, number> = {};
    let today = 0;
    let thisWeek = 0;
    let thisMonth = 0;

    for (const entry of all) {
      byType[entry.type] = (byType[entry.type] ?? 0) + 1;
      if (entry.createdAt >= todayStart) today++;
      if (entry.createdAt >= weekStart) thisWeek++;
      if (entry.createdAt >= monthStart) thisMonth++;
    }

    return { total: all.length, byType, today, thisWeek, thisMonth };
  }

  async count(filter?: ActivityQuery): Promise<number> {
    const results = await this.query(filter);
    return results.length;
  }

  async clear(type?: string): Promise<void> {
    if (type) {
      const items = await this.storage.find({ where: { type } });
      await this.storage.deleteMany(items.map(i => i.id));
    } else {
      await this.storage.clear();
    }
  }
}
