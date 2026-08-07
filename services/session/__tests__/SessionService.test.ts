import { describe, it, expect, beforeEach } from 'vitest';
import { SessionService } from '../SessionService';
import { MemoryAdapter } from '@infrastructure/storage/adapters/common/MemoryAdapter';

describe('SessionService', () => {
  let sessionService: SessionService;
  let cacheStorage: MemoryAdapter;

  beforeEach(async () => {
    cacheStorage = new MemoryAdapter();
    await cacheStorage.initialize();
    sessionService = new SessionService(cacheStorage, 60000); // 1 分钟 TTL
    await sessionService.initialize();
  });

  describe('create', () => {
    it('应该创建会话并返回会话 ID', async () => {
      const sessionId = await sessionService.create('play', { board: [], moves: [] });
      expect(sessionId).toMatch(/^sess:\d+:[a-z0-9]+$/);
    });

    it('应该使用默认 TTL', async () => {
      const sessionId = await sessionService.create('play', { board: [] });
      const session = await sessionService.get<{ board: unknown[] }>(sessionId);
      expect(session).not.toBeNull();
      expect(session!.data).toEqual({ board: [] });
    });

    it('应该支持自定义 TTL', async () => {
      const sessionId = await sessionService.create('play', { board: [] }, 5000);
      const session = await sessionService.get<{ board: unknown[] }>(sessionId);
      expect(session).not.toBeNull();
      expect(session!.expiresAt - session!.createdAt).toBe(5000);
    });
  });

  describe('get', () => {
    it('应该获取存在的会话', async () => {
      const sessionId = await sessionService.create('play', { board: [] });
      const session = await sessionService.get<{ board: unknown[] }>(sessionId);
      expect(session).not.toBeNull();
      expect(session!.id).toBe(sessionId);
      expect(session!.type).toBe('play');
      expect(session!.data).toEqual({ board: [] });
    });

    it('不存在的会话应返回 null', async () => {
      const session = await sessionService.get('sess:not-exist');
      expect(session).toBeNull();
    });

    it('应该更新最后访问时间', async () => {
      const sessionId = await sessionService.create('play', { board: [] });
      const before = Date.now();
      await new Promise(resolve => setTimeout(resolve, 10));
      const session = await sessionService.get<{ board: unknown[] }>(sessionId);
      const after = Date.now();
      expect(session!.lastAccessedAt).toBeGreaterThanOrEqual(before);
      expect(session!.lastAccessedAt).toBeLessThanOrEqual(after);
    });
  });

  describe('update', () => {
    it('应该更新会话数据', async () => {
      const sessionId = await sessionService.create('play', { board: [], moves: [] });
      await sessionService.update(sessionId, { board: [1, 2, 3], moves: ['A1'] });
      const session = await sessionService.get<{ board: number[]; moves: string[] }>(sessionId);
      expect(session!.data).toEqual({ board: [1, 2, 3], moves: ['A1'] });
    });

    it('默认应该刷新 TTL', async () => {
      const sessionId = await sessionService.create('play', { board: [] }, 5000);
      await new Promise(resolve => setTimeout(resolve, 100));
      await sessionService.update(sessionId, { board: [1] });
      const session = await sessionService.get<{ board: number[] }>(sessionId);
      expect(session!.expiresAt - session!.lastAccessedAt).toBe(60000); // 默认 TTL
    });

    it('可以选择不刷新 TTL', async () => {
      const sessionId = await sessionService.create('play', { board: [] }, 5000);
      const before = (await sessionService.get(sessionId))!.expiresAt;
      await sessionService.update(sessionId, { board: [1] }, false);
      const after = (await sessionService.get(sessionId))!.expiresAt;
      expect(after).toBe(before);
    });

    it('更新不存在的会话应抛出错误', async () => {
      await expect(sessionService.update('sess:not-exist', {})).rejects.toThrow('Session not found');
    });
  });

  describe('delete', () => {
    it('应该删除会话', async () => {
      const sessionId = await sessionService.create('play', { board: [] });
      await sessionService.delete(sessionId);
      const session = await sessionService.get(sessionId);
      expect(session).toBeNull();
    });
  });

  describe('has', () => {
    it('存在的会话应返回 true', async () => {
      const sessionId = await sessionService.create('play', { board: [] });
      expect(await sessionService.has(sessionId)).toBe(true);
    });

    it('不存在的会话应返回 false', async () => {
      expect(await sessionService.has('sess:not-exist')).toBe(false);
    });
  });

  describe('refresh', () => {
    it('应该刷新会话 TTL', async () => {
      const sessionId = await sessionService.create('play', { board: [] }, 5000);
      await sessionService.refresh(sessionId, 120000);
      const session = await sessionService.get(sessionId);
      expect(session!.expiresAt - session!.lastAccessedAt).toBe(120000);
    });

    it('应该使用默认 TTL', async () => {
      const sessionId = await sessionService.create('play', { board: [] }, 5000);
      await sessionService.refresh(sessionId);
      const session = await sessionService.get(sessionId);
      // 允许 1 秒的误差，因为异步操作有时间差
      const ttl = session!.expiresAt - session!.lastAccessedAt;
      expect(ttl).toBeGreaterThanOrEqual(59000);
      expect(ttl).toBeLessThanOrEqual(61000);
    });

    it('刷新不存在的会话应抛出错误', async () => {
      await expect(sessionService.refresh('sess:not-exist')).rejects.toThrow('Session not found');
    });
  });

  describe('getRemainingTime', () => {
    it('应该返回剩余时间', async () => {
      const sessionId = await sessionService.create('play', { board: [] }, 10000);
      const remaining = await sessionService.getRemainingTime(sessionId);
      expect(remaining).toBeGreaterThan(9000);
      expect(remaining).toBeLessThanOrEqual(10000);
    });

    it('不存在的会话应返回 0', async () => {
      expect(await sessionService.getRemainingTime('sess:not-exist')).toBe(0);
    });
  });

  describe('getByType', () => {
    it('应该按类型查询会话', async () => {
      await sessionService.create('play', { board: [] });
      await sessionService.create('play', { board: [1, 2] });
      await sessionService.create('review', { gameId: '123' });

      const playSessions = await sessionService.getByType<{ board: unknown[] }>('play');
      expect(playSessions.length).toBe(2);
      expect(playSessions.every(s => s.type === 'play')).toBe(true);

      const reviewSessions = await sessionService.getByType<{ gameId: string }>('review');
      expect(reviewSessions.length).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('应该清理过期会话', async () => {
      await sessionService.create('play', { board: [] }, 50); // 50ms 过期
      await sessionService.create('play', { board: [] }, 50000);

      await new Promise(resolve => setTimeout(resolve, 60));
      const cleaned = await sessionService.cleanup();
      expect(cleaned).toBe(1);
    });
  });
});
