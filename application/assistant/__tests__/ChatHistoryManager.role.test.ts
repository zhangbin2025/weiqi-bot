/**
 * ChatHistoryManager 的会话角色持久化
 *
 * 角色是会话固有属性（ChatSessionData.role），必须扛住 Manager 内部
 * 所有「重建 data」的保存点：addMessage / setCurrentSessionTitle /
 * clearCurrentSession。任一处漏了，发一条消息角色就丢了，历史会话
 * 打开时就会用错 system prompt 与插件能力。
 */

import { describe, it, expect } from 'vitest';
import { ChatHistoryManager, type ChatSessionData } from '../ChatHistoryManager';

/** 内存版 IFavoriteService：只实现 Manager 用到的几个方法 */
function makeFavoriteService() {
  const store = new Map<string, { id: string; category: string; key: string; data: ChatSessionData }>();
  const api = {
    async addFavorite(category: string, key: string, data: ChatSessionData): Promise<string> {
      const id = `fav:${key}`;
      const prev = store.get(key);
      store.set(key, { id, category, key, data: { ...(prev?.data ?? {}), ...data } });
      return id;
    },
    async getFavorite(_category: string, key: string) {
      return store.get(key) ?? null;
    },
    async getFavorites({ category }: { category: string }) {
      return [...store.values()].filter((f) => f.category === category);
    },
    async updateNote() {},
    async removeFavorite() {},
    async clear() {},
    async count() { return store.size; },
  };
  return { api, store };
}

const CATEGORY = 'chat-conversation-test';

function makeManager() {
  const { api, store } = makeFavoriteService();
  const history = new ChatHistoryManager(api as never, CATEGORY);
  return { history, store };
}

async function roleOf(history: ChatHistoryManager, sessionId: string): Promise<string | undefined> {
  const sessions = await history.getAllSessions();
  return sessions.find((s) => s.sessionId === sessionId)?.data.role;
}

describe('ChatSessionData.role 持久化', () => {
  it('setCurrentSessionRole 把角色写进会话数据', async () => {
    const { history } = makeManager();
    const id = await history.createSession('新对话');
    await history.setCurrentSessionRole('plugin');
    expect(await roleOf(history, id)).toBe('plugin');
  });

  it('addMessage 后角色不丢（saveCurrentSession 的覆盖式重建）', async () => {
    const { history } = makeManager();
    const id = await history.createSession('新对话');
    await history.setCurrentSessionRole('plugin');
    await history.addMessage({ role: 'user', content: '启用' });
    expect(await roleOf(history, id)).toBe('plugin');
  });

  it('setCurrentSessionTitle 后角色不丢', async () => {
    const { history } = makeManager();
    const id = await history.createSession('新对话');
    await history.setCurrentSessionRole('plugin');
    await history.addMessage({ role: 'user', content: '写个规则' });
    await history.setCurrentSessionTitle('写个规则');
    expect(await roleOf(history, id)).toBe('plugin');
  });

  it('clearCurrentSession 清空消息但保留角色（角色是会话固有属性）', async () => {
    const { history } = makeManager();
    const id = await history.createSession('新对话');
    await history.setCurrentSessionRole('plugin');
    await history.addMessage({ role: 'user', content: '启用' });
    await history.clearCurrentSession();
    expect(await roleOf(history, id)).toBe('plugin');
    const sessions = await history.getAllSessions();
    expect(sessions.find((s) => s.sessionId === id)?.data.messages).toHaveLength(0);
  });

  it('角色可被改写（空会话切换角色时直接改写本会话）', async () => {
    const { history } = makeManager();
    const id = await history.createSession('新对话');
    await history.setCurrentSessionRole('plugin');
    await history.setCurrentSessionRole('chat');
    expect(await roleOf(history, id)).toBe('chat');
  });

  it('老会话没有 role 字段：保持 undefined，由页面回退默认角色', async () => {
    const { history, store } = makeManager();
    const legacyId = 'session:legacy';
    store.set(legacyId, {
      id: 'fav:legacy', category: CATEGORY, key: legacyId,
      data: {
        title: '老会话', messages: [{ role: 'user', content: '你好', timestamp: 1 }],
        createdAt: 1, updatedAt: 1,
      },
    });
    expect(await roleOf(history, legacyId)).toBeUndefined();
  });

  it('loadSession 切换到历史会话后，角色仍从会话数据读取', async () => {
    const { history } = makeManager();
    const a = await history.createSession('A');
    await history.setCurrentSessionRole('plugin');
    const b = await history.createSession('B');
    await history.setCurrentSessionRole('chat');

    await history.loadSession(a);
    expect(await roleOf(history, a)).toBe('plugin');
    expect(await roleOf(history, b)).toBe('chat');
  });
});
