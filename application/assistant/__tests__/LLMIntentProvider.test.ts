import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  normalizeLLMResult,
  sanitizeLlmText,
  extractJson,
  repairLooseJson,
} from '../LLMIntentProvider';

describe('buildSystemPrompt', () => {
  it('包含所有真实意图与 chat/greeting/help/unknown', () => {
    const p = buildSystemPrompt();
    for (const intent of ['query_player', 'download_game', 'start_review', 'chat', 'greeting', 'help', 'unknown']) {
      expect(p).toContain(intent);
    }
    expect(p).toContain('允许参数');
    // 回归：打招呼示例不应再带一句会被 LLM 原样复读的固定话术
    expect(p).not.toContain('可以帮你查棋手、复盘、做题、下载棋谱');
  });

  it('prompt 明确区分 greeting 与 chat', () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/单纯打招呼/);
    expect(p).toContain('"intent":"greeting"');
    expect(p).toContain('"intent":"chat"');
  });
});

describe('sanitizeLlmText', () => {
  it('转义 HTML 并截断长度', () => {
    const out = sanitizeLlmText('<script>alert(1)</script>' + 'x'.repeat(3000), 2000);
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out.length).toBeLessThanOrEqual(2100);
  });

  it('打断 markdown 链接但不破坏普通方括号', () => {
    const out = sanitizeLlmText('[点我](javascript:alert(1)) 和 [普通]', 1000);
    expect(out).not.toContain('](');
    expect(out).toContain('[普通]');
  });

  it('去掉控制字符', () => {
    expect(sanitizeLlmText('a\u0000b', 100)).toBe('ab');
  });
});

describe('normalizeLLMResult', () => {
  it('合法意图：保留白名单内参数', () => {
    const r = normalizeLLMResult({
      intent: 'query_player',
      confidence: 0.9,
      params: { player: '柯洁', evil: '<script>' },
      responseType: 'foreground',
      alternatives: [],
      reply: '',
    });
    expect(r.kind).toBe('intent');
    if (r.kind !== 'intent') throw new Error('unreachable');
    expect(r.result.intent).toBe('query_player');
    expect(r.result.params).toEqual({ player: '柯洁' });
    expect(r.result.responseType).toBe('foreground');
  });

  it('丢弃白名单外的参数与非法类型', () => {
    const r = normalizeLLMResult({
      intent: 'start_puzzle',
      confidence: 0.8,
      params: { source: '野狐', count: { nested: 1 }, keyword: '<img src=x>', bogus: 'x' },
    });
    if (r.kind !== 'intent') throw new Error('unreachable');
    expect(r.result.params['source']).toBe('野狐');
    expect(r.result.params['count']).toBeUndefined();
    expect(r.result.params['keyword']).toBe('&lt;img src=x&gt;');
    expect(r.result.params['bogus']).toBeUndefined();
  });

  it('未知意图抛错', () => {
    expect(() => normalizeLLMResult({ intent: 'rm_rf', confidence: 1 })).toThrow(/未知意图/);
  });

  it('非对象抛错', () => {
    expect(() => normalizeLLMResult('hello')).toThrow(/不是 JSON 对象/);
  });

  it('confidence 钳制到 0~1，非法值用兜底', () => {
    const r = normalizeLLMResult({ intent: 'help', confidence: 99 });
    if (r.kind !== 'intent') throw new Error('unreachable');
    expect(r.result.confidence).toBe(1);
  });

  it('responseType 非法值回落 foreground', () => {
    const r = normalizeLLMResult({ intent: 'help', confidence: 0.5, responseType: 'destroy' });
    if (r.kind !== 'intent') throw new Error('unreachable');
    expect(r.result.responseType).toBe('foreground');
  });

  it('alternatives 过滤非法意图（只看前 3 项，避免被长数组拖住）', () => {
    const r = normalizeLLMResult({
      intent: 'help',
      confidence: 0.7,
      alternatives: [
        { intent: 'query_player', confidence: 0.4 },
        { intent: 'chat', confidence: 0.3 },   // chat 不允许作为候选
        { intent: 'help', confidence: 0.2 },    // 与主意图相同
        { intent: 'bogus', confidence: 0.1 },   // 超出前 3 项，直接不看
        { intent: 'start_play', confidence: 0.1 },
      ],
    });
    if (r.kind !== 'intent') throw new Error('unreachable');
    expect(r.result.alternatives?.map(a => a.intent)).toEqual(['query_player']);
  });

  it('alternatives 最多保留 3 个合法候选', () => {
    const r = normalizeLLMResult({
      intent: 'help',
      confidence: 0.7,
      alternatives: [
        { intent: 'query_player', confidence: 0.4 },
        { intent: 'start_play', confidence: 0.3 },
        { intent: 'start_review', confidence: 0.2 },
        { intent: 'download_game', confidence: 0.1 },
      ],
    });
    if (r.kind !== 'intent') throw new Error('unreachable');
    expect(r.result.alternatives).toHaveLength(3);
  });

  it('chat 返回转义后的回答', () => {
    const r = normalizeLLMResult({ intent: 'chat', confidence: 1, reply: '你好 <b>朋友</b>' });
    expect(r.kind).toBe('chat');
    if (r.kind !== 'chat') throw new Error('unreachable');
    expect(r.reply).toBe('你好 &lt;b&gt;朋友&lt;/b&gt;');
  });

  it('chat 回复为空时抛错', () => {
    expect(() => normalizeLLMResult({ intent: 'chat', reply: '' })).toThrow(/闲聊回复为空/);
  });

  it('greeting 返回独立 kind，不进执行流水线', () => {
    const r = normalizeLLMResult({ intent: 'greeting', confidence: 0.99, reply: '' });
    expect(r.kind).toBe('greeting');
  });

  it('greeting 忽略 reply，空 reply 也不报错', () => {
    expect(normalizeLLMResult({ intent: 'greeting', reply: '随便写点什么' }).kind).toBe('greeting');
    expect(normalizeLLMResult({ intent: 'greeting' }).kind).toBe('greeting');
  });

  it('greeting / chat 不允许作为候选意图', () => {
    const r = normalizeLLMResult({
      intent: 'help', confidence: 0.7,
      alternatives: [
        { intent: 'greeting', confidence: 0.5 },
        { intent: 'chat', confidence: 0.4 },
        { intent: 'query_player', confidence: 0.3 },
      ],
    });
    if (r.kind !== 'intent') throw new Error('unreachable');
    expect(r.result.alternatives?.map(a => a.intent)).toEqual(['query_player']);
  });
});


describe('extractJson 容错解析（回归：术语解释里 reply 带裸引号导致 V8 错误外泄）', () => {
  it('合法 JSON 原样解析', () => {
    expect(extractJson('{"intent":"chat","reply":"你好"}')).toEqual({ intent: 'chat', reply: '你好' });
  });

  it('容忍 ```json 代码围栏与前后废话', () => {
    const raw = '好的，结果如下：\n```json\n{"intent":"chat","reply":"你好"}\n```\n希望有帮助';
    expect(extractJson(raw)).toEqual({ intent: 'chat', reply: '你好' });
  });

  it('修复 reply 里未转义的 ASCII 双引号（双打吃案例）', () => {
    // 真实故障形态：解释术语时给词加英文引号，JSON 从 reply 处断开（position 46 附近）
    const broken = '{"intent":"chat","confidence":0.95,"reply":""双打吃"是指一步棋同时打吃对方两块棋。"}';
    const r = extractJson(broken) as Record<string, unknown>;
    expect(r['intent']).toBe('chat');
    expect(String(r['reply'])).toContain('双打吃');
    expect(String(r['reply'])).not.toContain('"');
  });

  it('修复字符串内的裸换行 / tab / 控制字符', () => {
    const broken = '{"intent":"chat","reply":"第一行\n第二行\t结束"}';
    const r = extractJson(broken) as Record<string, unknown>;
    expect(String(r['reply'])).toContain('第一行');
    expect(String(r['reply'])).toContain('第二行');
  });

  it('修复尾随逗号', () => {
    expect(repairLooseJson('{"a":1,}')).toBe('{"a":1}');
    expect(extractJson('{"intent":"chat","reply":"好",}')).toEqual({ intent: 'chat', reply: '好' });
  });

  it('JSON 后面跟含 } 的废话时仍能取到正确对象', () => {
    const raw = '{"intent":"chat","reply":"好"} 备注：{这不是 JSON}';
    expect(extractJson(raw)).toEqual({ intent: 'chat', reply: '好' });
  });

  it('结构引号不被误改：合法 JSON 修复前后完全一致', () => {
    const good = '{"intent":"query_player","params":{"player":"柯洁"},"reply":""}';
    expect(repairLooseJson(good)).toBe(good);
  });

  it('彻底无法解析时抛中文友好错误，不泄漏 V8 报错', () => {
    expect(() => extractJson('完全不是 JSON 的一段话')).toThrow(/不是合法 JSON/);
    expect(() => extractJson('完全不是 JSON 的一段话')).not.toThrow(/position|Expected|column/i);
  });

  it('半截 JSON（无结尾 }）也给出中文错误而不是 V8 报错', () => {
    expect(() => extractJson('{"intent":"chat","reply":"被掐断')).toThrow(/不是合法 JSON/);
  });

  it('合法转义引号 \\" 不被修复逻辑改坏', () => {
    const good = '{"intent":"chat","reply":"他说\\"你好\\""}';
    expect(repairLooseJson(good)).toBe(good);
    expect(extractJson(good)).toEqual({ intent: 'chat', reply: '他说"你好"' });
  });

  it('空字符串 / 只有空白 → 中文错误', () => {
    expect(() => extractJson('   ')).toThrow(/不是合法 JSON/);
    expect(() => extractJson('')).toThrow(/不是合法 JSON/);
  });

  it('多个 } 候选：末尾废话含 } 时优先取正确的那个完整对象', () => {
    const raw = '{"intent":"chat","reply":"双打吃解释"} 后面还有 {乱七八糟}';
    const r = extractJson(raw) as Record<string, unknown>;
    expect(r['intent']).toBe('chat');
    expect(String(r['reply'])).toBe('双打吃解释');
  });

  it('嵌套对象里的裸引号也能修复（params 值）', () => {
    const broken = '{"intent":"query_player","params":{"player":""柯洁"九段"},"reply":""}';
    const r = extractJson(broken) as Record<string, any>;
    expect(r['intent']).toBe('query_player');
    expect(String(r['params']['player'])).toContain('柯洁');
  });
});
