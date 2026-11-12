/**
 * AssistantRenderer：LLM 聊天回复用普通消息块 + 「聊天」意图标识
 * 分类/识别/跳转规则不受影响，这里只锁「显示」行为。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AssistantRenderer } from '../AssistantRenderer';

vi.mock('marked', () => ({
  marked: {
    setOptions: vi.fn(),
    parse: vi.fn(async (t: string) => `<p>${t}</p>`),
  },
}));

describe('AssistantRenderer 聊天意图标识', () => {
  let renderer: AssistantRenderer;

  beforeEach(() => {
    document.body.innerHTML = '<div id="chatContainer"></div>';
    Element.prototype.scrollIntoView = vi.fn();
    renderer = new AssistantRenderer();
  });

  afterEach(() => { vi.restoreAllMocks(); });

  const firstMessage = () => document.querySelector('#chatContainer .message') as HTMLElement;

  it('variant=chat：普通消息块 + 「聊天」徽章，无 chat class', async () => {
    await renderer.renderMessage('是呀，天气好适合摆一盘棋', false, null, null,
      undefined, undefined, false, undefined, undefined, 'chat');
    const msg = firstMessage();
    expect(msg.className).toBe('message assistant');           // 样式完全普通
    const badges = msg.querySelectorAll('.intent-badge');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toBe('聊天');
  });

  it('不传 variant 的普通助手消息没有徽章', async () => {
    await renderer.renderMessage('一条普通回复', false, null, null,
      undefined, undefined, false);
    expect(firstMessage().querySelectorAll('.intent-badge').length).toBe(0);
  });

  it('功能意图徽章照旧用 INTENT_CONFIG 中文名', async () => {
    await renderer.renderMessage('已为你跳转', false, 'query_player', { player: '柯洁' });
    expect(firstMessage().querySelector('.intent-badge')?.textContent).toBe('查询棋手');
  });

  it('旧历史数据 intent=chat 也显示「聊天」而非英文，且不重复', async () => {
    await renderer.renderMessage('旧闲聊', false, 'chat', null,
      undefined, undefined, false, undefined, undefined, 'chat');
    const badges = firstMessage().querySelectorAll('.intent-badge');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toBe('聊天');
  });

  it('用户消息即使带 variant 也不显示徽章', async () => {
    await renderer.renderMessage('你好', true, null, null,
      undefined, undefined, false, undefined, undefined, 'chat');
    expect(firstMessage().className).toContain('user');
    expect(firstMessage().querySelectorAll('.intent-badge').length).toBe(0);
  });

  it('prependMessage（历史/懒加载）同样显示「聊天」徽章', async () => {
    await renderer.prependMessage('聊点什么吧', false, null, null,
      undefined, undefined, undefined, undefined, 'chat');
    expect(firstMessage().querySelector('.intent-badge')?.textContent).toBe('聊天');
  });

  it('prependMessage 功能意图仍显示中文徽章', async () => {
    await renderer.prependMessage('功能消息', false, 'query_player', null);
    expect(firstMessage().querySelector('.intent-badge')?.textContent).toBe('查询棋手');
  });
});

describe('AssistantRenderer.renderPluginTrace（过程日志，纯展示）', () => {
  let renderer: AssistantRenderer;

  beforeEach(() => {
    document.body.innerHTML = '<div id="chatContainer"></div>';
    Element.prototype.scrollIntoView = vi.fn();
    renderer = new AssistantRenderer();
  });

  const steps = [
    { source: 'agent' as const, attempt: 1, phase: 'decision', ok: true, detail: '第 1 次决策：调用模型' },
    { source: 'codegen' as const, attempt: 1, phase: 'sandbox', ok: false, detail: '试算失败 TypeError', code: 'function rank(p){ return p }' },
    { source: 'codegen' as const, attempt: 2, phase: 'sandbox', ok: true, detail: '试算通过' },
  ];

  it('空 trace 不渲染任何 DOM', async () => {
    await renderer.renderPluginTrace([]);
    expect(document.querySelectorAll('.plugin-trace')).toHaveLength(0);
  });

  it('默认折叠，标题含步数与失败数', async () => {
    await renderer.renderPluginTrace(steps);
    const details = document.querySelector('details.plugin-trace__details') as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toContain('3 步');
    expect(details.querySelector('summary')?.textContent).toContain('1 步失败');
    expect(document.querySelectorAll('.plugin-trace__step')).toHaveLength(3);
  });

  it('每条步骤文本用 textContent，失败步有标记', async () => {
    await renderer.renderPluginTrace(steps);
    const rows = document.querySelectorAll('.plugin-trace__step');
    expect(rows[0]!.querySelector('.plugin-trace__detail')?.textContent).toBe('第 1 次决策：调用模型');
    expect(rows[0]!.querySelector('.plugin-trace__flag')?.textContent).toBe('✓');
    expect(rows[1]!.className).toContain('plugin-trace__step--fail');
    expect(rows[1]!.querySelector('.plugin-trace__flag')?.textContent).toBe('✗');
    expect(rows[1]!.querySelector('.plugin-trace__tag')?.textContent).toContain('代码 · 第 1 轮 · sandbox');
  });

  it('代码可展开、完整源码在 <pre> 里、复制按钮带原文', async () => {
    await renderer.renderPluginTrace(steps);
    const codeDetails = document.querySelector('details.plugin-trace__code') as HTMLDetailsElement;
    expect(codeDetails).not.toBeNull();
    expect(codeDetails.open).toBe(false);
    expect(codeDetails.querySelector('summary')?.textContent).toBe('查看本轮代码');
    expect(codeDetails.querySelector('pre')?.textContent).toBe('function rank(p){ return p }');
    const copyBtn = codeDetails.querySelector('button.copy-btn') as HTMLButtonElement;
    expect(copyBtn.getAttribute('data-copy')).toBe('function rank(p){ return p }');
    expect(copyBtn.getAttribute('data-bound')).toBe('true');
  });

  it('LLM 产出的 HTML/脚本注入只作为文本，不产生元素', async () => {
    const evil = [{ source: 'agent' as const, attempt: 1, phase: 'decision', ok: false,
      detail: '<img src=x onerror=alert(1)>', code: '<script>alert(2)</script>' }];
    await renderer.renderPluginTrace(evil);
    expect(document.querySelector('.plugin-trace img')).toBeNull();
    expect(document.querySelector('.plugin-trace script')).toBeNull();
    expect(document.querySelector('.plugin-trace__detail')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(document.querySelector('.plugin-trace__pre')?.textContent).toBe('<script>alert(2)</script>');
  });

  it('不写会话历史：只往 chatContainer 追加块，不产生 .message', async () => {
    await renderer.renderPluginTrace(steps);
    expect(document.querySelectorAll('#chatContainer .message')).toHaveLength(0);
    expect(document.querySelectorAll('#chatContainer .plugin-trace')).toHaveLength(1);
  });
});

describe('AssistantRenderer 实时过程日志（逐步输出）', () => {
  let renderer: AssistantRenderer;

  beforeEach(() => {
    document.body.innerHTML = '<div id="chatContainer"></div>';
    Element.prototype.scrollIntoView = vi.fn();
    renderer = new AssistantRenderer();
  });

  const step = (over: Partial<{ attempt: number; phase: string; ok: boolean; detail: string; code: string }> = {}) => ({
    source: 'agent' as const, attempt: 1, phase: 'decision', ok: true, detail: '调用模型', ...over,
  });

  it('begin 立即插入过程块且进行中默认展开，标题带「进行中」', () => {
    expect(renderer.beginPluginTrace()).toBe(true);
    const details = document.querySelector('details.plugin-trace__details') as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(true);
    expect(details.querySelector('summary')?.textContent).toContain('进行中');
    expect(document.querySelectorAll('.plugin-trace__step')).toHaveLength(0);
  });

  it('append 逐步增加行、标题实时更新步数，无需等结束', () => {
    renderer.beginPluginTrace();
    renderer.appendPluginTraceStep(step({ detail: '第 1 步' }));
    expect(document.querySelectorAll('.plugin-trace__step')).toHaveLength(1);
    expect(document.querySelector('.plugin-trace__summary')?.textContent).toContain('1 步');
    renderer.appendPluginTraceStep(step({ attempt: 2, phase: 'sandbox', ok: false, detail: '试算失败' }));
    expect(document.querySelectorAll('.plugin-trace__step')).toHaveLength(2);
    expect(document.querySelector('.plugin-trace__summary')?.textContent).toContain('2 步');
    expect(document.querySelector('.plugin-trace__summary')?.textContent).toContain('1 步失败');
    expect(document.querySelectorAll('.plugin-trace__step--fail')).toHaveLength(1);
  });

  it('实时追加的代码步骤也带完整源码与复制按钮', () => {
    renderer.beginPluginTrace();
    renderer.appendPluginTraceStep(step({ phase: 'llm', code: 'function rank(p){return p}' }));
    expect(document.querySelector('.plugin-trace__pre')?.textContent).toBe('function rank(p){return p}');
    expect(document.querySelector('.plugin-trace__code button.copy-btn')?.getAttribute('data-copy'))
      .toBe('function rank(p){return p}');
    expect(document.querySelector('.plugin-trace__code button.copy-btn')?.getAttribute('data-bound'))
      .toBe('true');
  });

  it('finish 后折叠、去掉「进行中」、标记完成', () => {
    renderer.beginPluginTrace();
    renderer.appendPluginTraceStep(step());
    renderer.finishPluginTrace(true);
    const details = document.querySelector('details.plugin-trace__details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    const title = document.querySelector('.plugin-trace__summary')?.textContent ?? '';
    expect(title).toContain('完成');
    expect(title).not.toContain('进行中');
    expect(document.querySelector('.plugin-trace')?.className).not.toContain('plugin-trace--failed');
  });

  it('finish(false) 标失败态；纯闲聊未 begin 时 append/finish 都安全', () => {
    renderer.beginPluginTrace();
    renderer.finishPluginTrace(false);
    expect(document.querySelector('.plugin-trace')?.className).toContain('plugin-trace--failed');
    // 没开过程块时静默忽略，不抛错
    expect(() => renderer.appendPluginTraceStep(step())).not.toThrow();
    expect(() => renderer.finishPluginTrace(true)).not.toThrow();
  });

  it('过程块插在 typing 指示器之前，主回复仍在过程块之后', () => {
    renderer.showTyping();
    renderer.beginPluginTrace();
    const children = [...document.getElementById('chatContainer')!.children];
    const traceIdx = children.findIndex((c) => c.className === 'plugin-trace');
    const typingIdx = children.findIndex((c) => c.id === 'typingIndicator');
    expect(traceIdx).toBeGreaterThanOrEqual(0);
    expect(typingIdx).toBeGreaterThanOrEqual(0);
    expect(traceIdx).toBeLessThan(typingIdx);
  });

  it('连续两轮：第二次 begin 会先收尾上一轮，不残留「进行中」', () => {
    renderer.beginPluginTrace();
    renderer.appendPluginTraceStep(step());
    renderer.beginPluginTrace();
    const titles = [...document.querySelectorAll('.plugin-trace__summary')].map((s) => s.textContent ?? '');
    expect(titles[0]).toContain('完成');
    expect(titles[0]).not.toContain('进行中');
    expect(titles[1]).toContain('进行中');
    expect(document.querySelectorAll('.plugin-trace')).toHaveLength(2);
  });

  it('实时步骤里的 HTML/脚本注入仍只作文本', () => {
    renderer.beginPluginTrace();
    renderer.appendPluginTraceStep(step({ detail: '<img src=x onerror=alert(1)>', code: '<script>alert(2)</script>' }));
    expect(document.querySelector('.plugin-trace img')).toBeNull();
    expect(document.querySelector('.plugin-trace script')).toBeNull();
    expect(document.querySelector('.plugin-trace__detail')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});


/**
 * 用户消息气泡里「复制 URL」卡片的边界回归
 *
 * 场景：用户先贴一个链接，紧接着用中文问问题（中间没有空格）。
 * 旧正则 /(?:https?|lib|katago):\/\/[^\s]+/ 以空白为唯一边界，会把整段
 * 中文问句吞进 URL，复制按钮的 data-copy 于是带上问句。
 *
 * 新规则：http(s) 按 RFC 3986 允许的 ASCII 字符切，非 ASCII（汉字/中文标点）
 * 自动成为边界；lib:// / katago:// 伪协议沿用原行为。
 */
describe('AssistantRenderer 用户消息 URL 复制边界', () => {
  let renderer: AssistantRenderer;

  beforeEach(() => {
    document.body.innerHTML = '<div id="chatContainer"></div>';
    Element.prototype.scrollIntoView = vi.fn();
    renderer = new AssistantRenderer();
  });

  afterEach(() => { vi.restoreAllMocks(); });

  /** 取用户消息里第一张 URL 卡片的「复制」按钮 data-copy。
   *  每次断言独立渲染：先清空容器，避免同 it 内多次调用累积旧消息。 */
  const copiedUrl = async (text: string): Promise<string | null> => {
    document.getElementById('chatContainer')!.innerHTML = '';
    await renderer.renderMessage(text, true, null, null, undefined, undefined, false);
    const btn = document.querySelector('#chatContainer .url-card button.copy-btn');
    return btn?.getAttribute('data-copy') ?? null;
  };

  it('复现：链接后紧跟中文问句（无空格）→ 只复制 URL，不带问句', async () => {
    const url = 'https://example.com/article';
    expect(await copiedUrl(`${url}这个网页讲了什么`)).toBe(url);
    expect(await copiedUrl(`${url}，请归纳一下`)).toBe(url);
    expect(await copiedUrl(`${url}。谢谢`)).toBe(url);
  });

  it('链接后有空格的普通写法仍正常', async () => {
    const url = 'https://example.com/article';
    expect(await copiedUrl(`${url} 这个网页讲了什么`)).toBe(url);
  });

  it('合法 URL 的 path / query / fragment / percent-encode 不被切断', async () => {
    // 全部是 RFC 3986 合法 ASCII（中文已 percent-encode），应完整复制
    const cases = [
      'https://example.com/a/b?x=1&y=2#frag',
      'https://example.com/%E4%B8%AD%E6%96%87?q=%E6%9F%AF%E6%B4%81',
      'https://example.com/a_b-c~d/e.f',
    ];
    for (const url of cases) {
      expect(await copiedUrl(url)).toBe(url);
    }
  });

  it('一句话里多个链接 + 中文提问，各自成卡片且都不带问句', async () => {
    await renderer.renderMessage(
      '对比 https://a.com/1 和 https://b.com/2 这两个哪个好',
      true, null, null, undefined, undefined, false,
    );
    const copies = Array.from(
      document.querySelectorAll('#chatContainer .url-card button.copy-btn'),
    ).map((b) => b.getAttribute('data-copy'));
    expect(copies).toEqual(['https://a.com/1', 'https://b.com/2']);
  });

  it('lib:// / katago:// 伪协议沿用原行为，复制完整串', async () => {
    expect(await copiedUrl('lib://life-and-death/abcdef0123456789abcdef0123456789 这题怎么做'))
      .toBe('lib://life-and-death/abcdef0123456789abcdef0123456789');
    expect(await copiedUrl('katago://date/2026-11-12 讲讲这盘'))
      .toBe('katago://date/2026-11-12');
  });

  it('只有协议头没有主体时不生成 URL 卡片', async () => {
    expect(await copiedUrl('https:// 这个不完整')).toBeNull();
  });
});
