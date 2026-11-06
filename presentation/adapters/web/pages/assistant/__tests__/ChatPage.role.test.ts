/**
 * ChatPage 的会话角色规则
 *
 * 两条用户明确要求：
 * 1. 已有聊天记录的会话不能切换角色（中途换 prompt 会让同一段历史
 *    被两套知识体系解释，上下文乱套）。
 * 2. 历史会话要有角色标识，打开时必须恢复它自己的角色。
 *
 * ChatPage 构造函数会 new 真实 Renderer / Dialog / IndexedDB，不适合在
 * 单元环境整体实例化。这里用 `Object.create(ChatPage.prototype)` 绕过构造，
 * 只注入被测私有方法真正碰到的端口 —— 测的是规则本身，不是装配过程。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ChatPage } from '../ChatPage';

interface Harness {
  page: ChatPage & Record<string, unknown>;
  calls: {
    render: string[];
    createSession: number;
    setRole: string[];
    syncUI: number;
    dialogContent: string;
  };
  doc: Document;
}

function makeHarness(
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }> = [],
  opts: { realRoleUI?: boolean } = {},
): Harness {
  // vitest 的 jsdom 环境自带 document；不要覆盖全局 document（可能是只读 getter），
  // 直接在它的 body 上铺 DOM。
  const doc = document;
  doc.body.innerHTML = `
    <button id="roleBtn"></button><div id="roleMenu"></div>
    <textarea id="userInput"></textarea><div id="chatTitle"></div>`;

  const calls = {
    render: [] as string[], createSession: 0, setRole: [] as string[],
    syncUI: 0, dialogContent: '',
  };
  const page = Object.create(ChatPage.prototype) as ChatPage & Record<string, unknown>;
  page['currentRole'] = 'chat';
  page['_sessions'] = [] as Array<{ sessionId: string; data: Record<string, unknown> }>;

  page['history'] = {
    getCurrentSession: () => ({ sessionId: 's1', messages: page['_msgs'] ?? messages }),
    getAllSessions: async () => page['_sessions'],
    setCurrentSessionRole: async (role: string) => { calls.setRole.push(role); },
    createSession: async () => { calls.createSession++; return 'new'; },
    loadSession: async () => page['_msgs'] ?? messages,
  };
  page['renderer'] = {
    renderMessage: async (text: string) => { calls.render.push(text); },
    clearMessages() {},
  };
  page['dialog'] = {
    show: async (opts: { content: string }) => { calls.dialogContent = opts.content; },
    close() {},
  };
  // UI 组要测真实 syncRoleUI，不能 mock 掉；其余组用计数 mock 即可
  if (!opts.realRoleUI) page['syncRoleUI'] = () => { calls.syncUI++; };
  page['syncReadyState'] = () => {};
  page['toggleRoleMenu'] = () => {};
  page['toggleMenu'] = () => {};
  page['renderSession'] = async () => {};
  page['updateTitle'] = () => {};
  page['scrollToBottom'] = () => {};
  page['formatTime'] = () => '10:00';
  page['escapeHtml'] = (t: string) => String(t).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]!);
  page['sessionTitleFromSession'] = () => '标题';

  return { page, calls, doc };
}

beforeEach(() => {
  // switchRole / writeSessionRole 会碰 localStorage；jsdom 环境未必全局可用
  (globalThis as Record<string, unknown>).localStorage = {
    setItem() {}, getItem() { return null; }, removeItem() {},
  };
});

describe('角色锁定：已有聊天记录不能切换', () => {
  it('有记录时拒绝切换，角色不变、不新建会话、不改写会话数据，并给出提示', async () => {
    const { page, calls } = makeHarness([{ role: 'user', content: '写个规则', timestamp: 1 }]);
    await (page.switchRole as (r: string) => Promise<void>)('plugin');
    expect(page['currentRole']).toBe('chat');
    expect(calls.createSession).toBe(0);
    expect(calls.setRole).toHaveLength(0);
    expect(calls.render.some((t) => t.includes('已有聊天记录') && t.includes('不能切换'))).toBe(true);
    expect(calls.render.some((t) => t.includes('新建会话'))).toBe(true);
  });

  it('点当前角色是 no-op（不弹提示、不新建会话）', async () => {
    const { page, calls } = makeHarness([{ role: 'user', content: '你好', timestamp: 1 }]);
    await (page.switchRole as (r: string) => Promise<void>)('chat');
    expect(calls.render).toHaveLength(0);
    expect(calls.createSession).toBe(0);
  });

  it('空会话允许直接切换：改写本会话角色，不新建会话（不留空会话垃圾）', async () => {
    const { page, calls } = makeHarness([]);
    await (page.switchRole as (r: string) => Promise<void>)('plugin');
    expect(page['currentRole']).toBe('plugin');
    expect(calls.setRole).toContain('plugin');
    expect(calls.createSession).toBe(0);
    expect(calls.render.some((t) => t.includes('已切换到'))).toBe(true);
  });

  it('清空后（无消息）同一会话可再切角色', async () => {
    const { page, calls } = makeHarness([]);
    await (page.switchRole as (r: string) => Promise<void>)('plugin');
    await (page.switchRole as (r: string) => Promise<void>)('chat');
    expect(page['currentRole']).toBe('chat');
    expect(calls.setRole).toEqual(['plugin', 'chat']);
  });
});

describe('readSessionRole：角色来自会话数据，不是页面侧映射', () => {
  it('plugin / chat 正确读取；缺失、脏数据、找不到会话都回退默认闲聊', async () => {
    const { page } = makeHarness();
    page['_sessions'] = [
      { sessionId: 'a', data: { role: 'plugin', messages: [] } },
      { sessionId: 'b', data: { role: 'chat', messages: [] } },
      { sessionId: 'old', data: { messages: [] } },
      { sessionId: 'dirty', data: { role: 'garbage', messages: [] } },
    ];
    const read = (id: string): Promise<string> =>
      (page.readSessionRole as (id: string) => Promise<string>).call(page, id);
    expect(await read('a')).toBe('plugin');
    expect(await read('b')).toBe('chat');
    expect(await read('old')).toBe('chat');
    expect(await read('dirty')).toBe('chat');
    expect(await read('missing')).toBe('chat');
  });
});

describe('打开历史会话：恢复它自己的角色', () => {
  it('点击历史卡片后 currentRole 变成该会话的角色，并刷新角色 UI', async () => {
    const { page, calls } = makeHarness([]);
    page['_sessions'] = [{
      sessionId: 'hist1',
      data: { role: 'plugin', messages: [{ role: 'user', content: '启用', timestamp: 1 }] },
    }];
    page['_msgs'] = [{ role: 'user', content: '启用', timestamp: 1 }];
    document.body.innerHTML = '<div class="session-card" data-session-id="hist1"></div>';

    (page.bindSessionCards as () => void)();
    document.querySelector('.session-card')!.dispatchEvent(new Event('click'));
    await new Promise((r) => setTimeout(r, 20)); // 等 async click handler

    expect(page['currentRole']).toBe('plugin');
    expect(calls.syncUI).toBeGreaterThan(0);
  });
});

describe('角色 UI：锁定态与历史列表徽标', () => {
  it('有记录时按钮带 🔒、下拉有说明、非当前角色禁用', () => {
    const { page, doc } = makeHarness([{ role: 'user', content: '启用', timestamp: 1 }], { realRoleUI: true });
    page['currentRole'] = 'plugin';
    (ChatPage.prototype as unknown as { syncRoleUI: () => void }).syncRoleUI.call(page);

    const btn = doc.getElementById('roleBtn')!;
    expect(btn.textContent).toContain('🔒');
    expect(btn.classList.contains('role-btn--locked')).toBe(true);
    expect(doc.querySelector('.role-menu__hint')).not.toBeNull();
    const opts = [...doc.querySelectorAll('.role-option')];
    expect(opts).toHaveLength(2);
    expect(opts.filter((o) => (o as HTMLButtonElement).disabled)).toHaveLength(1);
  });

  it('空会话按钮是 ▾、无锁定提示、所有角色可选', () => {
    const { page, doc } = makeHarness([], { realRoleUI: true });
    (ChatPage.prototype as unknown as { syncRoleUI: () => void }).syncRoleUI.call(page);
    const btn = doc.getElementById('roleBtn')!;
    expect(btn.textContent).toContain('▾');
    expect(btn.textContent).not.toContain('🔒');
    expect(doc.querySelector('.role-menu__hint')).toBeNull();
    expect([...doc.querySelectorAll('.role-option')]
      .every((o) => !(o as HTMLButtonElement).disabled)).toBe(true);
  });

  it('历史列表卡片显示角色徽标；老会话标「（旧）」', async () => {
    const { page, calls, doc } = makeHarness([]);
    page['_sessions'] = [
      { sessionId: 'a', data: { role: 'plugin', updatedAt: 3, messages: [] } },
      { sessionId: 'old', data: { updatedAt: 2, messages: [] } },
    ];
    await (page.showHistory as () => Promise<void>)();
    expect(calls.dialogContent).toContain('🧩 插件开发');
    expect(calls.dialogContent).toContain('💬 闲聊（旧）');
    expect(calls.dialogContent).toContain('session-card__role');
  });
});
