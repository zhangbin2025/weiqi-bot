import { describe, it, expect } from 'vitest';
import { parseAgentResponse, safeAgentReply } from '../AgentProtocol';

const ok = (reply: string, kind: string, extra: Record<string, string> = {}) =>
  JSON.stringify({ reply, action: { kind, ...extra } });

describe('parseAgentResponse', () => {
  it('解析标准严格 JSON', () => {
    const r = parseAgentResponse('{"reply":"你好","action":{"kind":"none"}}');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.response.reply).toBe('你好');
    expect(r.response.action.kind).toBe('none');
  });

  it('容忍 ```json 围栏 + 前后多余文字', () => {
    const raw = '好的，我来处理：\n```json\n{"reply":"已生成","action":{"kind":"plugin.create","name":"规则","intent":"同分比胜局","code":"function rank(p){return p}"}}\n```\n以上。';
    const r = parseAgentResponse(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.response.action.kind).toBe('plugin.create');
    expect(r.response.action.code).toContain('function rank');
  });

  it('无围栏但后面跟含 } 的废话也能抠出对象', () => {
    const raw = '{"reply":"x","action":{"kind":"none"}} 后面还有一段 } 废话';
    expect(parseAgentResponse(raw).ok).toBe(true);
  });

  it('多余字段一律忽略（防伪造权限/字段）', () => {
    const raw = JSON.stringify({
      reply: 'x',
      action: { kind: 'plugin.list', artifactId: 'fake', admin: true, raw: 'whatever' },
      conversationHistory: [{ role: 'user', content: '私密内容' }],
    });
    const r = parseAgentResponse(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.response.action).sort()).toEqual(['artifactId', 'kind']);
    expect('admin' in r.response.action).toBe(false);
    expect(JSON.stringify(r.response)).not.toContain('私密内容');
  });

  it('plugin.toggle 的 enabled 只接受布尔，字符串会被丢弃（按当前状态翻转）', () => {
    const okTrue = parseAgentResponse(JSON.stringify({
      reply: 'x', action: { kind: 'plugin.toggle', artifactId: 'plugin:1', enabled: true },
    }));
    expect(okTrue.ok).toBe(true);
    if (okTrue.ok) expect(okTrue.response.action.enabled).toBe(true);

    const okFalse = parseAgentResponse(JSON.stringify({
      reply: 'x', action: { kind: 'plugin.toggle', artifactId: 'plugin:1', enabled: false },
    }));
    expect(okFalse.ok).toBe(true);
    if (okFalse.ok) expect(okFalse.response.action.enabled).toBe(false);

    const stringValued = parseAgentResponse(JSON.stringify({
      reply: 'x', action: { kind: 'plugin.toggle', artifactId: 'plugin:1', enabled: 'true' },
    }));
    expect(stringValued.ok).toBe(true);
    if (stringValued.ok) expect(stringValued.response.action.enabled).toBeUndefined();
  });

  it('空输出 / 非字符串 / 纯文本 → 明确 reason', () => {
    expect(parseAgentResponse('').reason).toContain('空');
    expect(parseAgentResponse('   ').reason).toContain('空');
    expect(parseAgentResponse('随便聊聊').reason).toContain('JSON');
    expect(parseAgentResponse(undefined as unknown as string).reason).toContain('空');
  });

  it('缺 reply / reply 非字符串 → 拒绝', () => {
    expect(parseAgentResponse('{"action":{"kind":"none"}}').reason).toContain('reply');
    expect(parseAgentResponse('{"reply":123,"action":{"kind":"none"}}').reason).toContain('reply');
  });

  it('缺 action / action 是数组或字符串 → 拒绝', () => {
    expect(parseAgentResponse('{"reply":"x"}').reason).toContain('action');
    expect(parseAgentResponse('{"reply":"x","action":[]}').reason).toContain('action');
    expect(parseAgentResponse('{"reply":"x","action":"none"}').reason).toContain('action');
  });

  it('非法 kind / 缺 kind → 拒绝', () => {
    expect(parseAgentResponse(ok('x', 'plugin.exec')).reason).toContain('kind');
    expect(parseAgentResponse('{"reply":"x","action":{}}').reason).toContain('kind');
  });

  it('plugin.create 必须有 code', () => {
    const r = parseAgentResponse(ok('x', 'plugin.create', { name: 'r', intent: 'i' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('code');
    expect(r.reason).toContain('diff');
  });

  it('plugin.create 的 code 为空白 / 非字符串 → 拒绝', () => {
    expect(parseAgentResponse(ok('x', 'plugin.create', { code: '   ' })).ok).toBe(false);
    expect(parseAgentResponse('{"reply":"x","action":{"kind":"plugin.create","code":123}}').ok).toBe(false);
  });

  it('plugin.create 带完整 code 通过', () => {
    const r = parseAgentResponse(ok('x', 'plugin.create', { code: 'function rank(p){return p}', name: 'r' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.response.action.name).toBe('r');
  });

  it('plugin.revise 必须同时有 code 与 artifactId', () => {
    expect(parseAgentResponse(ok('x', 'plugin.revise', { code: 'c' })).reason).toContain('artifactId');
    expect(parseAgentResponse(ok('x', 'plugin.revise', { artifactId: 'a' })).reason).toContain('code');
    const good = parseAgentResponse(ok('x', 'plugin.revise', { code: 'c', artifactId: 'a', feedback: '排反了' }));
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.response.action.feedback).toBe('排反了');
  });

  it('plugin.show / plugin.toggle / plugin.delete 必须有 artifactId', () => {
    for (const k of ['plugin.show', 'plugin.toggle', 'plugin.delete']) {
      expect(parseAgentResponse(ok('x', k)).reason).toContain('artifactId');
      expect(parseAgentResponse(ok('x', k, { artifactId: 'plugin:1' })).ok).toBe(true);
    }
  });

  it('plugin.show 解析通过且不需要 code', () => {
    const r = parseAgentResponse(ok('给你看源码', 'plugin.show', { artifactId: 'plugin:1' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.response.action.kind).toBe('plugin.show');
    expect(r.response.action.artifactId).toBe('plugin:1');
    expect(r.response.action.code).toBeUndefined();
  });

  it('plugin.list / none 不需要额外字段', () => {
    expect(parseAgentResponse(ok('x', 'plugin.list')).ok).toBe(true);
    expect(parseAgentResponse(ok('x', 'none')).ok).toBe(true);
  });

  it('脚本注入文本不会被当作动作执行（协议解析只看合法 kind）', () => {
    const raw = '{"reply":"<img src=x onerror=alert(1)>","action":{"kind":"none"}}';
    const r = parseAgentResponse(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.response.reply).toContain('<img');
    expect(safeAgentReply(r.response.reply, 200)).not.toContain('<img');
  });

  it('嵌套/畸形 JSON 不崩溃', () => {
    expect(parseAgentResponse('{"reply":"x","action":{"kind":').ok).toBe(false);
    expect(parseAgentResponse('[1,2,3]').ok).toBe(false);
    expect(parseAgentResponse('null').ok).toBe(false);
  });
});

describe('safeAgentReply', () => {
  it('转义 HTML 敏感字符', () => {
    const s = safeAgentReply(`<script>alert("x" & 'y')</script>`, 500);
    expect(s).not.toContain('<script>');
    expect(s).toContain('&lt;script&gt;');
    expect(s).toContain('&quot;');
    expect(s).toContain('&#39;');
    expect(s).toContain('&amp;');
  });

  it('去掉控制字符', () => {
    expect(safeAgentReply('a\u0000b\u001Fc', 500)).toBe('abc');
  });

  it('按 maxChars 截断并加省略号', () => {
    expect(safeAgentReply('abcdefghij', 5)).toBe('abcde…');
  });

  it('maxChars 为 0 / 负数不崩', () => {
    expect(safeAgentReply('abc', 0)).toBe('…');
    expect(safeAgentReply('abc', -1)).toBe('…');
  });

  it('不截断时保持原文（仅转义）', () => {
    expect(safeAgentReply('hello', 100)).toBe('hello');
  });
});
