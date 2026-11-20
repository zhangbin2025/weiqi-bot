/** @vitest-environment jsdom */
/**
 * 通用 prefs-add: 链接的宿主行为：
 * 1. 点合法代码 → 只回灌一条正常用户消息（走 useCase.send），宿主**一行存储都不写**；
 * 2. 脏 href / 形状不合法 / 非本 scheme → 静默忽略，不回灌、不写库；
 * 3. 与 secret-prompt 的差别由 PrefLink 契约保证（此处锁住「不托管存储」这条）。
 *
 * 用 Object.create(prototype) + 捕获 click handler，避免整页实例化（会 new
 * 真实 Renderer / IndexedDB）与 document 级监听器在多个用例间累积。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatPage } from '../ChatPage';

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

describe('bindPrefLinks —— 通用 prefs-add: 链路', () => {
  it('合法通用链接（marked 编码后的中文）：回灌带 domain/key/值的用户消息，宿主不写库', () => {
    // 真实 DOM：marked 把 北京 编码成 %E5%8C%97%E4%BA%AC
    click('prefs-add:prefs:weather.watchlist:%E5%8C%97%E4%BA%AC');
    expect(send).toHaveBeenCalledTimes(1);
    const text = String(send.mock.calls[0]![0]);
    expect(text).toContain('北京'); // 回灌给用户的是解码后的明文
    expect(text).toContain('weather.watchlist');
    expect(text).toContain("domain='prefs'");
    expect(text).toContain('保存到本地偏好');
    expect(page['kvKit']).toBeUndefined();
  });

  it('股票代码（ASCII 明文）通用链接同样回灌', () => {
    click('prefs-add:prefs:stock.watchlist:sh600519');
    expect(send).toHaveBeenCalledTimes(1);
    expect(String(send.mock.calls[0]![0])).toContain('sh600519');
  });

  it('closest 未匹配本 scheme 的链接：不触发', () => {
    click('anything', false);
    expect(send).not.toHaveBeenCalled();
  });

  it('外站 URL 即使长得像也不回灌', () => {
    click('https://evil.example/x');
    expect(send).not.toHaveBeenCalled();
  });

  it('脏通用 href：静默忽略，不回灌', () => {
    for (const bad of [
      'prefs-add:prefs:weather.watchlist:北京:多余',
      'prefs-add:Prefs:k:v',
      'prefs-add:prefs:k:<script>',
    ]) {
      send.mockClear();
      click(bad);
      expect(send).not.toHaveBeenCalled();
    }
  });
});
