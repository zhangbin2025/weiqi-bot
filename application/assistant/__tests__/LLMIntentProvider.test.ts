import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  normalizeLLMResult,
  sanitizeLlmText,
  extractJson,
  repairLooseJson,
  sanitizePuzzleKeyword,
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

  // 回归：围棋相关的知识问答（棋手交战历史等）必须落 chat，不能判 unknown。
  // 旧定义把 chat 限死为「与围棋功能无关」，导致这类问句 LLM 无处安放 → unknown
  // → 用户看到「抱歉,我不太理解您的意思」。
  it('聊天/知识问答覆盖围棋相关提问，unknown 只留给乱码', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('闲聊与知识问答');
    expect(p).toContain('棋手交战历史');
    expect(p).not.toContain('与围棋功能无关的聊天');
    expect(p).toMatch(/仅限乱码/);
    expect(p).toMatch(/区分「问答」与「功能调用」/);
    // 正例：这句必须被示范成 chat
    expect(p).toContain('用户输入: 柯洁和申真谞的交战历史');
    const idx = p.indexOf('用户输入: 柯洁和申真谞的交战历史');
    expect(p.slice(idx, idx + 120)).toContain('"intent":"chat"');
    // 功能调用仍然走功能意图，不能被 chat 吞掉
    expect(p).toContain('用户输入: 帮我查查柯洁的等级分');
    const qIdx = p.indexOf('用户输入: 帮我查查柯洁的等级分');
    expect(p.slice(qIdx, qIdx + 120)).toContain('"intent":"query_player"');
  });

  // 回归：2026-11-05 用户实测「比赛」被 LLM 判 chat → 功能助手 handleHelp()
  // 回显功能引导，而引导里恰好写着「示例：比赛 → 查询赛事」，前后矛盾。
  // prompt 必须把本地识别器的触发词交给模型，并明确孤词优先级。
  it('prompt 注入触发词，并明确「比赛」→ search_event 而非 chat', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('触发词:');
    expect(p).toContain('赛事、比赛、大赛');
    expect(p).toContain('触发词优先级');
    expect(p).toContain('不要判 chat / greeting / unknown');
    expect(p).toContain('用户输入: 比赛');
    const idx = p.indexOf('用户输入: 比赛');
    expect(p.slice(idx, idx + 160)).toContain('"intent":"search_event"');
    // 背景/历史知识问答仍归 chat，不能被新规则吞掉
    expect(p).toContain('仍按规则 6 归 chat');
  });

  // 回归：「双打吃」被 LLM 判 start_puzzle 且编造 keyword='双打吃'，
  // 题库筛出 0 道题。prompt 必须把 keyword 限定为合法题型/难度，概念题归「棋理」。
  it('prompt 明确 start_puzzle.keyword 只能是题库合法题型（概念题归棋理）', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('start_puzzle 的 keyword');
    expect(p).toContain('棋理');
    expect(p).toContain('双打吃');
    expect(p).toContain('否则题库会筛出 0 道题');
    // 正例：概念题示范成 keyword=棋理，而不是把术语原词塞进去
    const idx = p.indexOf('用户输入: 来几道双打吃的题');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(p.slice(idx, idx + 200)).toContain('"keyword":"棋理"');
  });
});

describe('sanitizePuzzleKeyword（start_puzzle.keyword 代码级护栏）', () => {
  it('合法题型原样保留', () => {
    for (const t of ['棋理', '死活', '手筋', '官子', '中盘', '布局', '对杀', '死活题']) {
      expect(sanitizePuzzleKeyword(t), t).toBe(t);
    }
  });

  it('难度原子与 and/or 表达式原样保留', () => {
    expect(sanitizePuzzleKeyword('2D')).toBe('2D');
    expect(sanitizePuzzleKeyword('15K')).toBe('15K');
    expect(sanitizePuzzleKeyword('(死活 or 官子) and 2D')).toBe('(死活 or 官子) and 2D');
    expect(sanitizePuzzleKeyword('死活 and (3D or 4D)')).toBe('死活 and (3D or 4D)');
  });

  it('空串 = 不筛选，原样保留', () => {
    expect(sanitizePuzzleKeyword('')).toBe('');
    expect(sanitizePuzzleKeyword('   ')).toBe('');
  });

  it('概念词/术语原词降级为「棋理」', () => {
    for (const t of ['双打吃', '双活', '双飞燕', '倒脱靴', '征子', '打吃']) {
      expect(sanitizePuzzleKeyword(t), t).toBe('棋理');
    }
  });

  it('混合表达式里只要有一个非法原子就整体降级', () => {
    expect(sanitizePuzzleKeyword('死活 and 双打吃')).toBe('棋理');
  });

  it('HTML / 注入残片不会透传给题库', () => {
    expect(sanitizePuzzleKeyword('<img src=x>')).toBe('棋理');
    expect(sanitizePuzzleKeyword('&lt;img src=x&gt;')).toBe('棋理');
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
    // 回归：非法 keyword（HTML 残片）不再原样透传给题库，护栏收敛为「棋理」
    expect(r.result.params['keyword']).toBe('棋理');
    expect(r.result.params['bogus']).toBeUndefined();
  });

  it('未知意图抛错', () => {
    expect(() => normalizeLLMResult({ intent: 'rm_rf', confidence: 1 })).toThrow(/未知意图/);
  });

  it('回归：用户实测 LLM 输出 start_puzzle + keyword=双打吃 → 护栏收敛为棋理', () => {
    // 2026-11-04 用户贴的真实 /chat/completions 返回：
    // {"intent":"start_puzzle","confidence":0.74,"params":{"keyword":"双打吃"},...}
    // 分类结果保留，只修 keyword：题库里没有「双打吃」这个标签，会筛出 0 道题。
    const r = normalizeLLMResult({
      intent: 'start_puzzle',
      confidence: 0.74,
      params: { keyword: '双打吃' },
      responseType: 'foreground',
      alternatives: [{ intent: 'unknown', confidence: 0.16 }],
      reply: '',
    });
    if (r.kind !== 'intent') throw new Error('unreachable');
    expect(r.result.intent).toBe('start_puzzle');
    expect(r.result.params['keyword']).toBe('棋理');
  });

  it('合法 keyword 不被护栏改写', () => {
    const r = normalizeLLMResult({
      intent: 'start_puzzle', confidence: 0.9,
      params: { keyword: '(死活 or 官子) and 2D' },
    });
    if (r.kind !== 'intent') throw new Error('unreachable');
    expect(r.result.params['keyword']).toBe('(死活 or 官子) and 2D');
  });

  it('没给 keyword 时保持不筛选，不擅自塞棋理', () => {
    const r = normalizeLLMResult({ intent: 'start_puzzle', confidence: 0.9, params: {} });
    if (r.kind !== 'intent') throw new Error('unreachable');
    expect(r.result.params['keyword']).toBeUndefined();
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
