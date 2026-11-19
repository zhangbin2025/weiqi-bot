/** @vitest-environment jsdom */
/**
 * 「添加到自选」链接的宿主行为：
 * 1. 点合法代码 → 只回灌一条正常用户消息（走 useCase.send），宿主**一行存储都不写**；
 * 2. 脏 href / 形状不合法 / 非本 scheme → 静默忽略，不回灌、不写库；
 * 3. 与 secret-prompt 的差别由 PrefLink 契约保证（此处锁住「不托管存储」这条）。
 *
 * 用 Object.create(prototype) + 捕获 click handler，避免整页实例化（会 new
 * 真实 Renderer / IndexedDB）与 document 级监听器在多个用例间累积。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatPage } from '../ChatPage';
import { PREF_ADD_WATCH_SCHEME } from '../PrefLink';

type ClickHandler = (event: {
  target: { closest: (sel: string) => unknown } | null;
  preventDefault: () => void;
}) => void;

let handler: ClickHandler | undefined;
let send: ReturnType<typeof vi.fn>;
let page: ChatPage & Record<string, unknown>;

beforeEach(() => {
  handler = undefined;
  // 捕获 bindPrefLinks 注册的 document click 回调，不真的挂到全局 document
  vi.spyOn(document, 'addEventListener').mockImplementation((type, cb) => {
    if (type === 'click') handler = cb as unknown as ClickHandler;
  });
  send = vi.fn(async () => {});
  page = Object.create(ChatPage.prototype) as ChatPage & Record<string, unknown>;
  page['useCase'] = { send };
  (page as unknown as { bindPrefLinks: () => void }).bindPrefLinks();
});

afterEach(() => vi.restoreAllMocks());

/** 模拟一次点击：matched=false 表示 target.closest 没匹配到本 scheme 的链接 */
function click(href: string | null, matched = true): void {
  if (!handler) throw new Error('未捕获到 click handler');
  const link = { getAttribute: (name: string) => (name === 'href' ? href : null) };
  handler({
    target: { closest: (_sel: string) => (matched ? link : null) },
    preventDefault: () => {},
  });
}

describe('bindPrefLinks', () => {
  it('合法代码：回灌一条用户消息，消息里带代码且要求保存偏好；宿主不调任何 kv 接口', () => {
    click(`${PREF_ADD_WATCH_SCHEME}sh600519`);
    expect(send).toHaveBeenCalledTimes(1);
    const text = String(send.mock.calls[0]![0]);
    expect(text).toContain('sh600519');
    expect(text).toContain('加入我的自选');
    expect(text).toContain('保存到本地偏好');
    // 宿主侧没有任何 kvKit / service 注入，若实现偷偷写库这里会直接抛错测不过；
    // 更关键的是契约上「写」发生在 LLM 下一轮，不在这个 handler 里。
    expect(page['kvKit']).toBeUndefined();
  });

  it('各市场合法代码都能通过', () => {
    for (const code of ['sz300750', 'hk00700', 'usAAPL']) {
      send.mockClear();
      click(`${PREF_ADD_WATCH_SCHEME}${code}`);
      expect(send).toHaveBeenCalledTimes(1);
    }
  });

  it('脏 href / 形状不合法：静默忽略', () => {
    for (const bad of [
      '', 'sh60051', 'sh6005190', 'sz300750,sh600519',
      '../../secrets/github_token', 'javascript:alert(1)', null,
    ]) {
      send.mockClear();
      click(bad);
      expect(send).not.toHaveBeenCalled();
    }
  });

  it('非本 scheme 的链接（closest 未匹配）：不触发', () => {
    click(`${PREF_ADD_WATCH_SCHEME}sh600519`, false);
    expect(send).not.toHaveBeenCalled();
  });

  it('外站 URL 即使长得像也不回灌', () => {
    send.mockClear();
    click('https://evil.example/stock-watch-add:sh600519');
    expect(send).not.toHaveBeenCalled();
  });
});
