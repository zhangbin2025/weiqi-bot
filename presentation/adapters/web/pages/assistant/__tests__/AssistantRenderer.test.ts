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
