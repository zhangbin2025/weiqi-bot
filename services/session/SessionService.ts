import type { ISessionService } from './ISessionService';
import type { ISessionData } from './ISessionData';
import type { ICacheStorageAdapter } from '../../infrastructure/storage/interfaces/ICacheStorage';

/**
 * 会话服务实现
 * @description 基于 ICacheStorage 的会话管理，支持自动过期
 */
export class SessionService implements ISessionService {
  private readonly storage: ICacheStorageAdapter;
  private readonly defaultTtl: number;

  constructor(storage: ICacheStorageAdapter, defaultTtl?: number) {
    this.storage = storage;
    this.defaultTtl = defaultTtl ?? 30 * 60 * 1000; // 默认 30 分钟
  }

  async initialize(): Promise<void> {
    await this.storage.initialize();
  }

  async create<T>(type: string, data: T, ttl?: number): Promise<string> {
    const id = this.generateSessionId();
    const now = Date.now();
    const actualTtl = ttl ?? this.defaultTtl;

    const session: ISessionData<T> = {
      id,
      type,
      data,
      createdAt: now,
      lastAccessedAt: now,
      expiresAt: now + actualTtl,
    };

    await this.storage.set(id, session, actualTtl);
    return id;
  }

  async get<T>(id: string): Promise<ISessionData<T> | null> {
    const session = await this.storage.get<ISessionData<T>>(id);
    if (!session) return null;

    // 更新最后访问时间
    session.lastAccessedAt = Date.now();
    const remainingTtl = session.expiresAt - session.lastAccessedAt;
    await this.storage.set(id, session, remainingTtl);

    return session;
  }

  async update<T>(id: string, data: T, refreshTtl: boolean = true): Promise<void> {
    const session = await this.storage.get<ISessionData<T>>(id);
    if (!session) throw new Error(`Session not found: ${id}`);

    session.data = data;
    session.lastAccessedAt = Date.now();

    if (refreshTtl) {
      session.expiresAt = session.lastAccessedAt + this.defaultTtl;
      await this.storage.set(id, session, this.defaultTtl);
    } else {
      const remainingTtl = session.expiresAt - session.lastAccessedAt;
      await this.storage.set(id, session, remainingTtl);
    }
  }

  async delete(id: string): Promise<void> {
    await this.storage.delete(id);
  }

  async has(id: string): Promise<boolean> {
    return await this.storage.has(id);
  }

  async refresh(id: string, ttl?: number): Promise<void> {
    const session = await this.storage.get<ISessionData>(id);
    if (!session) throw new Error(`Session not found: ${id}`);

    const actualTtl = ttl ?? this.defaultTtl;
    session.lastAccessedAt = Date.now();
    session.expiresAt = session.lastAccessedAt + actualTtl;

    await this.storage.set(id, session, actualTtl);
  }

  async getRemainingTime(id: string): Promise<number> {
    const session = await this.storage.get<ISessionData>(id);
    if (!session) return 0;

    return Math.max(0, session.expiresAt - Date.now());
  }

  async getByType<T>(type: string): Promise<ISessionData<T>[]> {
    const allKeys = await this.storage.keys();
    const sessions: ISessionData<T>[] = [];

    for (const key of allKeys) {
      const session = await this.storage.get<ISessionData<T>>(key);
      if (session && session.type === type) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  async cleanup(): Promise<number> {
    return await this.storage.cleanup();
  }

  private generateSessionId(): string {
    return `sess:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  }
}
