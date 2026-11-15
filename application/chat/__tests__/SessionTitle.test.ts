/**
 * 会话标题：模型精炼 + 统一字数上限
 *
 * 锁住三条：
 * 1. 字数上限是一个明说的 UI 约定（CHAT_TITLE_MAX_CHARS），按 Unicode 码点算；
 * 2. 模型返回带引号/前缀/换行/废话时能被收拾干净，异常时静默降级；
 * 3. 标题任务走纯文本网关链路，短输入不额外发请求。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  CHAT_TITLE_MAX_CHARS, CHAT_TITLE_TASK,
  clampTitle, cleanModelTitle, generateSessionTitle, needsModelTitle,
  truncateChars,
} from '../SessionTitle';
import type { IModelGateway, ModelRequest } from '../../model/IModelGateway';

function gateway(text = '柯洁对局复盘') {
  return {
    isReady: vi.fn(() => true),
    execute: vi.fn(async (_req: ModelRequest) => ({ text, truncated: false })),
  } as unknown as IModelGateway & { isReady: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn> };
}

describe('clampTitle / truncateChars', () => {
  it('压平空白、按码点截断，不切坏 emoji', () => {
    expect(clampTitle('  柯洁和\n申真谞  交战如何  ')).toBe('柯洁和 申真谞 交战如何');
    const long = '啊'.repeat(CHAT_TITLE_MAX_CHARS + 10);
    expect([...clampTitle(long)]).toHaveLength(CHAT_TITLE_MAX_CHARS);
    expect(truncateChars('😀😀😀', 2)).toBe('😀😀');
    expect([...truncateChars('😀😀😀', 2)]).toHaveLength(2);
  });

  it('空文本回落「新对话」', () => {
    expect(clampTitle('   ')).toBe('新对话');
    expect(clampTitle('')).toBe('新对话');
  });
});

describe('cleanModelTitle', () => {
  it('去掉前缀与成对包裹符号', () => {
    expect(cleanModelTitle('标题：「柯洁对局复盘」')).toBe('柯洁对局复盘');
    expect(cleanModelTitle('会话标题: "定式查询"')).toBe('定式查询');
  });

  it('只取第一行，丢掉解释与代码块', () => {
    expect(cleanModelTitle('定式查询\n\n说明：这是标题')).toBe('定式查询');
    expect(cleanModelTitle('说明：这是标题\n\n定式查询')).toBe('说明：这是标题');
  });

  it('压空白、去首尾标点、仍受上限约束', () => {
    expect(cleanModelTitle('  柯洁  复盘。  ')).toBe('柯洁 复盘');
    const s = cleanModelTitle('啊'.repeat(100));
    expect(s).not.toBeNull();
    expect([...s!]).toHaveLength(CHAT_TITLE_MAX_CHARS);
  });

  it('空 / 纯标点返回 null（调用方保留兜底标题）', () => {
    expect(cleanModelTitle('   ')).toBeNull();
    expect(cleanModelTitle('《》')).toBeNull();
    expect(cleanModelTitle('标题：')).toBeNull();
  });
});

describe('generateSessionTitle', () => {
  const long = '请帮我详细分析一下柯洁和申真谞最近十盘对局里的布局变化';
  const short = '你好';

  it('短输入不劳烦模型，直接返回 null', async () => {
    const gw = gateway();
    expect(needsModelTitle(short)).toBe(false);
    expect(await generateSessionTitle(gw, short)).toBeNull();
    expect(gw.execute).not.toHaveBeenCalled();
  });

  it('长输入发一次纯文本标题请求，system 里写明同一个上限', async () => {
    const gw = gateway('柯洁申真谞布局');
    expect(needsModelTitle(long)).toBe(true);
    expect(await generateSessionTitle(gw, long)).toBe('柯洁申真谞布局');
    expect(gw.execute).toHaveBeenCalledTimes(1);
    const req = gw.execute.mock.calls[0]![0] as ModelRequest;
    expect(req.task).toBe(CHAT_TITLE_TASK);
    expect(req.tools).toBeUndefined();
    expect(req.options?.jsonMode).toBe(false);
    expect(String(req.messages[0]!.content)).toContain(String(CHAT_TITLE_MAX_CHARS));
    expect(req.messages[1]).toEqual({ role: 'user', content: long });
  });

  it('模型未就绪 / 抛错 / 返回废话 → 静默降级 null', async () => {
    const notReady = gateway();
    notReady.isReady.mockReturnValue(false);
    expect(await generateSessionTitle(notReady, long)).toBeNull();
    expect(notReady.execute).not.toHaveBeenCalled();

    const throwing = gateway();
    throwing.execute.mockRejectedValueOnce(new Error('timeout'));
    expect(await generateSessionTitle(throwing, long)).toBeNull();

    const punctuation = gateway('《》');
    expect(await generateSessionTitle(punctuation, long)).toBeNull();
    const empty = gateway('   ');
    expect(await generateSessionTitle(empty, long)).toBeNull();
  });
});
