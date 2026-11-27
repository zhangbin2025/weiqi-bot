/**
 * 内置正则算子的契约回归（2026-11-25：从 workflow-operator.regex_extract
 * 插件下沉为宿主内置）。
 *
 * 验收点：
 * - 三个算子各自 name / definition 稳定、idempotent:true、纯 value→value；
 * - regex_match 单次匹配、拒 g/y、给结构信息；
 * - regex_extract 全局 / 捕获组 / 去重 / withIndex / limit / 零宽不卡死；
 * - regex_replace 标准 $1 / $& 语义、flags 不强制补 g；
 * - flags 不静默过滤（非法标志明确报错）、参数类型严格、失败不产 value、
 *   观察不回灌正文。
 */
import { describe, it, expect } from 'vitest';
import {
  createRegexPrimitives,
  createRegexMatchPrimitive,
  createRegexExtractPrimitive,
  createRegexReplacePrimitive,
  REGEX_MATCH_TOOL_NAME,
  REGEX_EXTRACT_TOOL_NAME,
  REGEX_REPLACE_TOOL_NAME,
} from '../RegexPrimitives';

/** 用结构化参数调用，取完整 PrimitiveResult。 */
async function run(
  p: ReturnType<typeof createRegexMatchPrimitive>,
  args: Record<string, unknown>,
) {
  return p.execute(args);
}

describe('createRegexPrimitives — 三个内置算子的注册契约', () => {
  it('一次给出 match / extract / replace，名字 snake_case、不带点、幂等', () => {
    const ps = createRegexPrimitives();
    expect(ps.map((p) => p.name)).toEqual([
      REGEX_MATCH_TOOL_NAME, REGEX_EXTRACT_TOOL_NAME, REGEX_REPLACE_TOOL_NAME,
    ]);
    for (const p of ps) {
      expect(p.name).not.toContain('.');
      expect(p.idempotent).toBe(true);
      expect(p.definition.name).toBe(p.name);
      expect(p.definition.parameters.required).toContain('text');
      expect(p.definition.parameters.required).toContain('pattern');
      expect((p.definition.parameters as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    }
  });

  it('三个算子都不读缓存、不解析配方：零依赖工厂可直接构造', () => {
    // 构造时不需要任何 deps，纯计算算子的硬性边界；execute 也只吃 argsJson。
    expect(() => createRegexPrimitives()).not.toThrow();
  });
});

describe('regex_match — 首个命中的结构信息', () => {
  const p = createRegexMatchPrimitive();

  it('命中：给 matched / match / index / groups，正文不进 observation', async () => {
    const r = await run(p, { text: 'ab12 cd34', pattern: '([a-z]+)(\\d+)', flags: '' });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({
      matched: true, match: 'ab12', index: 0, groups: ['ab', '12'],
    });
    expect(r.observation).not.toContain('ab12');
    expect(r.detail).toContain('命中');
  });

  it('未命中：matched:false，不抛错', async () => {
    const r = await run(p, { text: 'hello', pattern: 'zzz' });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ matched: false });
  });

  it('拒 g / y：lastIndex 状态会让单次匹配不确定', async () => {
    for (const flags of ['g', 'y', 'gi', 'my']) {
      const r = await run(p, { text: 'abc', pattern: 'a', flags });
      expect(r.ok).toBe(false);
      expect(r.detail).toContain('flags 不能含 g / y');
      expect(r.value).toBeUndefined();
    }
  });

  it('未参与匹配的捕获组按空串', async () => {
    const r = await run(p, { text: 'a', pattern: '(a)|(b)' });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ matched: true, match: 'a', index: 0, groups: ['a', ''] });
  });
});

describe('regex_extract — 全局提取', () => {
  const p = createRegexExtractPrimitive();

  it('缺省 flags 自动补 g，输出命中文本数组', async () => {
    const r = await run(p, { text: 'a1 b2 c3', pattern: '[a-z]\\d' });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual(['a1', 'b2', 'c3']);
    expect(r.observation).toContain('提取 3 条命中');
    expect(r.observation).not.toContain('a1');
  });

  it('group 取捕获组（含 group=2），越界组按空串不跳过', async () => {
    const r = await run(p, {
      text: 'a1 b2 c3', pattern: '([a-z])(\\d)', group: 2, flags: 'g',
    });
    expect(r.value).toEqual(['1', '2', '3']);
    const over = await run(p, { text: 'ab cd', pattern: '(ab)', group: 5, flags: 'g' });
    expect(over.value).toEqual(['']);
  });

  it('unique:true 按首次出现顺序去重', async () => {
    const r = await run(p, {
      text: 'x x y x', pattern: 'x', flags: 'g', unique: true,
    });
    expect(r.value).toEqual(['x']);
  });

  it('withIndex:true 给 {value,index} 对象数组，可直接喂 display_json_list', async () => {
    const r = await run(p, {
      text: 'ab cd', pattern: 'cd', flags: 'g', withIndex: true,
    });
    expect(r.value).toEqual([{ value: 'cd', index: 3 }]);
  });

  it('limit 由调用方显式声明，省略则不限条数', async () => {
    const limited = await run(p, { text: 'abcdef', pattern: '', flags: 'g', limit: 3 });
    expect(limited.value).toEqual(['', '', '']);
    const all = await run(p, { text: 'a b c', pattern: '[a-c]', flags: 'g' });
    expect(all.value).toEqual(['a', 'b', 'c']);
    const bad = await run(p, { text: 'a', pattern: 'a', limit: 0 });
    expect(bad.ok).toBe(false);
    expect(bad.detail).toContain('limit 必须是正整数');
  });

  it('零宽匹配手动推进 lastIndex：文本长度 n 命中 n+1 个位置，limit 能截断', async () => {
    // 'ab' 只有 3 个零宽位置（0/1/2），不传 limit 时循环必须自行终止、不卡死。
    const all = await run(p, { text: 'ab', pattern: '', flags: 'g' });
    expect(all.ok).toBe(true);
    expect(all.value).toEqual(['', '', '']);
    // 更长文本给 limit:5，验证上限来自调用方显式声明而非宿主常数。
    const limited = await run(p, { text: 'abcdef', pattern: '', flags: 'g', limit: 5 });
    expect(limited.value).toEqual(['', '', '', '', '']);
  });

  it('显式 flags 里不含 g 时自动补，其余标志原样保留', async () => {
    const r = await run(p, { text: 'ABC abc', pattern: 'abc', flags: 'i' });
    expect(r.value).toEqual(['ABC', 'abc']);
  });

  it('零命中给空数组（不是 null / 不是未定义）', async () => {
    const r = await run(p, { text: 'hello', pattern: 'zzz', flags: 'g' });
    expect(r.value).toEqual([]);
  });
});

describe('regex_replace — 标准替换语义', () => {
  const p = createRegexReplacePrimitive();

  it('缺省 g 全局替换', async () => {
    const r = await run(p, { text: 'a1 b2', pattern: '\\d', replacement: '#' });
    expect(r.value).toBe('a# b#');
    expect(r.ok).toBe(true);
  });

  it('显式 flags 不含 g 时只替换首个，不强制补 g', async () => {
    const r = await run(p, {
      text: 'foo', pattern: 'o', flags: '', replacement: '0',
    });
    expect(r.value).toBe('f0o');
  });

  it('$1 / $& / $$ 按 String.prototype.replace 标准语义', async () => {
    const g1 = await run(p, {
      text: 'a1 b2', pattern: '([a-z])(\\d)', flags: 'g', replacement: '$2$1',
    });
    expect(g1.value).toBe('1a 2b');
    const amp = await run(p, {
      text: 'ab', pattern: 'a', flags: '', replacement: '[$&]',
    });
    expect(amp.value).toBe('[a]b');
  });
});

describe('三算子共用的严格边界', () => {
  const ps = [
    createRegexMatchPrimitive(), createRegexExtractPrimitive(), createRegexReplacePrimitive(),
  ];

  it('参数不是对象 / 缺 text / 缺 pattern 一律结构化失败，不产 value', async () => {
    for (const p of ps) {
      const notObj = await p.execute([] as unknown as Record<string, unknown>);
      expect(notObj.ok).toBe(false);
      const noText = await run(p, { pattern: 'a' });
      expect(noText.ok).toBe(false);
      expect(noText.detail).toContain('text 必须是字符串');
      const noPattern = await run(p, { text: 'a' });
      expect(noPattern.ok).toBe(false);
      expect(noPattern.detail).toContain('pattern 必须是字符串');
      expect(noText.value).toBeUndefined();
    }
  });

  it('flags 不静默过滤：非法标志由 RegExp 引擎报错并结构化回灌', async () => {
    const r = await run(createRegexExtractPrimitive(), {
      text: 'abc', pattern: 'a', flags: 'qg',
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('正则执行失败');
    expect(r.value).toBeUndefined();
  });

  it('非法正则源字符串（未闭合括号）结构化失败', async () => {
    const r = await run(createRegexMatchPrimitive(), { text: 'abc', pattern: '(' });
    expect(r.ok).toBe(false);
    expect(r.value).toBeUndefined();
  });

  it('regex_replace 缺 replacement 时不静默当空串（执行器也做最后一道保险）', async () => {
    const p = createRegexReplacePrimitive();
    expect(p.definition.parameters.required).toContain('replacement');
    const missing = await run(p, { text: 'abc', pattern: 'a' });
    expect(missing.ok).toBe(false);
    expect(missing.detail).toContain('replacement 必填');
    expect(missing.value).toBeUndefined();
    // 显式给空串是合法业务值：把命中删掉。
    const explicitEmpty = await run(p, { text: 'abc', pattern: 'b', replacement: '' });
    expect(explicitEmpty.ok).toBe(true);
    expect(explicitEmpty.value).toBe('ac');
  });

  it('观察文本只给摘要，不含源文本 / 命中内容', async () => {
    const r = await run(createRegexExtractPrimitive(), {
      text: '极机密正文-不该回灌', pattern: '极机密', flags: 'g',
    });
    expect(r.ok).toBe(true);
    expect(r.observation).not.toContain('极机密');
    expect(r.observation).toContain('纯 value 出参');
  });
});
