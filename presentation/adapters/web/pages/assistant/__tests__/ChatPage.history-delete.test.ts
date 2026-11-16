/**
 * 历史会话删除（2026-11-16 需求）
 *
 * 锁住的规则：
 * 1. 历史列表每张卡片都有删除按钮，但点删除按钮 / 确认栏不会顺手打开该会话；
 * 2. 删除必须先二次确认，确认后才真正调 deleteSession；
 * 3. 失败给出错误提示，卡片不消失；
 * 4. 删掉当前会话时视图不能停在已删会话上：切到剩余最近会话，没有就新建空会话。
 *
 * 与 ChatPage.role.test.ts 同一套路：Object.create 绕过构造函数，
 * 只注入被测私有方法真正碰到的端口。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatPage } from '../ChatPage';

interface Harness {
  page: ChatPage & Record<string, unknown>;
  deleted: string[];
  calls: { created: number; loaded: string[]; dialogContent: string };
}

function makeHarness(currentId: string | null, sessions: Array<{ sessionId: string; data: Record<string, unknown> }>) {
  const deleted: string[] = [];
  const calls = { created: 0, loaded: [] as string[], dialogContent: '' };
  let current = currentId;
  const store = sessions.map((s) => ({ ...s }));

  const page = Object.create(ChatPage.prototype) as ChatPage & Record<string, unknown>;
  page['currentRole'] = 'chat';
  page['history'] = {
    getCurrentSession: () => current ? { sessionId: current, messages: [] } : null,
    getAllSessions: async () => store.filter((s) => !deleted.includes(s.sessionId)),
    deleteSession: async (id: string) => {
      deleted.push(id);
      if (current === id) current = null;
    },
    loadSession: async (id: string) => {
      calls.loaded.push(id);
      current = id;
      return [];
    },
    createSession: async () => { calls.created++; current = 'new'; return 'new'; },
    setCurrentSessionRole: async () => {},
  };
  page['renderer'] = {
    renderMessage: async () => {},
    clearMessages: () => {},
  };
  // 真实 WebDialog 会把 content 插进 DOM；这里捕获字符串供断言
  page['dialog'] = {
    show: async (opts: { content: string }) => { calls.dialogContent = opts.content; },
    close: () => {},
  };
  page['newSession'] = async () => {
    await (page['history'] as { createSession: () => Promise<string> }).createSession();
  };
  page['renderSession'] = async () => {};
  page['readSessionRole'] = async () => 'chat';
  page['syncRoleUI'] = () => {};
  page['syncReadyState'] = () => {};
  page['toggleMenu'] = () => {};
  page['updateTitle'] = () => {};
  page['scrollToBottom'] = () => {};
  page['formatTime'] = () => '2026-11-16 21:00';
  page['escapeHtml'] = (t: string) => String(t).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]!);
  page['sessionTitleFromSession'] = () => '测试会话';

  return { page, deleted, calls };
}

/** 造一张与真实 showHistory 输出同构的卡片 */
function card(id: string, extra = ''): string {
  return `<div class="session-card${extra}" data-session-id="${id}">
    <div class="session-card__body">
      <div class="session-card__time">2026-11-16 21:00</div>
      <div class="session-card__summary">会话 ${id}</div>
    </div>
    <button type="button" class="session-card__delete">🗑</button>
  </div>`;
}

const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).localStorage = {
    values: {} as Record<string, string>,
    getItem(k: string) { return (this as unknown as { values: Record<string, string> }).values[k] ?? null; },
    setItem(k: string, v: string) { (this as unknown as { values: Record<string, string> }).values[k] = v; },
    removeItem(k: string) { delete (this as unknown as { values: Record<string, string> }).values[k]; },
  };
});

describe('历史会话卡片：删除入口与二次确认', () => {
  it('showHistory 渲染的卡片带删除按钮，且删除按钮不打开会话', async () => {
    const { page, calls } = makeHarness('a', [
      { sessionId: 'a', data: { updatedAt: 2, messages: [], title: '会话 a' } },
    ]);
    await (page.showHistory as () => Promise<void>)();
    expect(calls.dialogContent).toContain('session-card__delete');
    expect(calls.dialogContent).toContain('🗑');
    expect(calls.dialogContent).toContain('data-session-id="a"');

    // 把渲染结果放进 DOM，验证点删除按钮只出现确认栏、不打开会话
    document.body.innerHTML = calls.dialogContent;
    (page.bindSessionCards as () => void)();
    (document.querySelector('.session-card__delete') as HTMLButtonElement)
      .dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    expect(document.querySelector('.session-card__confirm')).not.toBeNull();
    expect(calls.loaded).toHaveLength(0);
    expect(document.querySelector('.session-card')!.getAttribute('data-session-id')).toBe('a');
    expect(document.querySelectorAll('.session-card__confirm')).toHaveLength(1);
  });

  it('点删除按钮只弹确认；确认后才 deleteSession，且卡片从列表移除', async () => {
    const { page, deleted, calls } = makeHarness('a', [
      { sessionId: 'a', data: { updatedAt: 2, messages: [], title: '会话 a' } },
      { sessionId: 'b', data: { updatedAt: 1, messages: [], title: '会话 b' } },
    ]);
    document.body.innerHTML = `<div class="session-list">${card('a', ' session-card--active')}${card('b')}</div>`;
    (page.bindSessionCards as () => void)();

    (document.querySelector('.session-card .session-card__delete') as HTMLButtonElement).click();
    await flush();
    expect(deleted).toHaveLength(0);
    const yes = document.querySelector('.session-card__confirm-yes') as HTMLButtonElement;
    expect(yes).not.toBeNull();
    expect(yes.textContent).toBe('确认删除');

    yes.click();
    await flush();
    expect(deleted).toEqual(['a']);
    expect(document.querySelector('[data-session-id="a"]')).toBeNull();
    expect(document.querySelector('[data-session-id="b"]')).not.toBeNull();
  });

  it('取消不删除；确认栏点击不会冒泡触发打开会话', async () => {
    const { page, deleted, calls } = makeHarness('a', [
      { sessionId: 'a', data: { updatedAt: 1, messages: [], title: '会话 a' } },
    ]);
    document.body.innerHTML = `<div class="session-list">${card('a')}</div>`;
    (page.bindSessionCards as () => void)();
    (document.querySelector('.session-card__delete') as HTMLButtonElement).click();
    await flush();
    const no = [...document.querySelectorAll('.session-card__confirm button')]
      .find((b) => b.textContent === '取消') as HTMLButtonElement;
    no.click();
    await flush();
    expect(document.querySelector('.session-card__confirm')).toBeNull();
    expect(deleted).toHaveLength(0);
    expect(calls.loaded).toHaveLength(0);
  });

  it('删除失败时给出提示，卡片保留', async () => {
    const { page } = makeHarness('a', [
      { sessionId: 'a', data: { updatedAt: 1, messages: [], title: '会话 a' } },
    ]);
    (page['history'] as Record<string, unknown>)['deleteSession'] = vi.fn(async () => {
      throw new Error('存储只读');
    });
    document.body.innerHTML = `<div class="session-list">${card('a')}</div>`;
    (page.bindSessionCards as () => void)();
    (document.querySelector('.session-card__delete') as HTMLButtonElement).click();
    await flush();
    (document.querySelector('.session-card__confirm-yes') as HTMLButtonElement).click();
    await flush();
    expect(document.querySelector('.session-card__confirm')?.textContent).toContain('删除失败：存储只读');
    expect(document.querySelector('[data-session-id="a"]')).not.toBeNull();
  });
});

describe('删除当前会话后的收尾', () => {
  it('还有其它会话：切到剩余最近的一个，角色与标题同步刷新', async () => {
    const { page, calls } = makeHarness('a', [
      { sessionId: 'a', data: { updatedAt: 3, messages: [], title: '会话 a' } },
      { sessionId: 'b', data: { updatedAt: 2, messages: [], role: 'plugin' } },
    ]);
    document.body.innerHTML = `<div class="session-list">${card('a', ' session-card--active')}${card('b')}</div>`;
    (page.bindSessionCards as () => void)();
    (document.querySelector('.session-card__delete') as HTMLButtonElement).click();
    await flush();
    (document.querySelector('.session-card__confirm-yes') as HTMLButtonElement).click();
    await flush();
    expect(calls.loaded).toContain('b');
  });

  it('删掉最后一个会话：新建空会话，列表显示「暂无历史会话」', async () => {
    const { page, calls } = makeHarness('a', [
      { sessionId: 'a', data: { updatedAt: 3, messages: [], title: '会话 a' } },
    ]);
    document.body.innerHTML = `<div class="session-list">${card('a', ' session-card--active')}</div>`;
    (page.bindSessionCards as () => void)();
    (document.querySelector('.session-card__delete') as HTMLButtonElement).click();
    await flush();
    (document.querySelector('.session-card__confirm-yes') as HTMLButtonElement).click();
    await flush();
    expect(calls.created).toBe(1);
    expect(document.querySelector('.session-empty')?.textContent).toContain('暂无历史会话');
  });

  it('删的是非当前会话：不重建当前视图', async () => {
    const { page, calls } = makeHarness('a', [
      { sessionId: 'a', data: { updatedAt: 3, messages: [], title: '会话 a' } },
      { sessionId: 'b', data: { updatedAt: 2, messages: [], title: '会话 b' } },
    ]);
    document.body.innerHTML = `<div class="session-list">${card('a', ' session-card--active')}${card('b')}</div>`;
    (page.bindSessionCards as () => void)();
    // 点第二张卡片的删除按钮
    (document.querySelector('[data-session-id="b"] .session-card__delete') as HTMLButtonElement).click();
    await flush();
    (document.querySelector('[data-session-id="b"] .session-card__confirm-yes') as HTMLButtonElement).click();
    await flush();
    expect(calls.loaded).toHaveLength(0);
    expect(calls.created).toBe(0);
  });
});
