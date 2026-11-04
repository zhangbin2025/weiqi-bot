/**
 * 输入框 API Key 脱敏 / 还原 单元测试
 */
import { describe, it, expect } from 'vitest';
import { maskApiKeysInText, restoreApiKeys, pruneRestorations } from '../ApiKeyInputMask';

const KEY = 'sk-abcdefghijklmnop1234';
const tokenOf = (k: string) => 'sk-***' + k.slice(-4);

describe('maskApiKeysInText', () => {
  it('/llm 配置命令里的 sk- key 被脱敏，且能还原成原文', () => {
    const raw = `/llm https://api.example.com/v1 ${KEY} tc-code-latest`;
    const { display, restorations } = maskApiKeysInText(raw);
    expect(display).toBe(`/llm https://api.example.com/v1 ${tokenOf(KEY)} tc-code-latest`);
    expect(restorations).toHaveLength(1);
    expect(restorations[0]).toEqual({ token: tokenOf(KEY), raw: KEY });
    expect(restoreApiKeys(display, restorations)).toBe(raw);
  });

  it('没有 key 的文本原样返回、无还原项', () => {
    const raw = '帮我查查柯洁的段位';
    const r = maskApiKeysInText(raw);
    expect(r.display).toBe(raw);
    expect(r.restorations).toEqual([]);
    expect(restoreApiKeys(r.display, r.restorations)).toBe(raw);
  });

  it('已是脱敏 token 的文本不再二次脱敏（幂等）', () => {
    const masked = `/llm https://api.example.com ${tokenOf(KEY)} tc-code-latest`;
    const r = maskApiKeysInText(masked);
    expect(r.display).toBe(masked);
    expect(r.restorations).toEqual([]);
  });

  it('/llm 子命令（status/model/off）不会被当成 key 脱敏', () => {
    for (const sub of ['status', 'model', 'off', 'timeout', 'maxtokens', 'thinking']) {
      const raw = `/llm ${sub} 90`;
      const r = maskApiKeysInText(raw);
      expect(r.display, sub).toBe(raw);
      expect(r.restorations, sub).toEqual([]);
    }
  });

  it('/llm 第 3 段不带 sk- 前缀的 key 也会被脱敏并还原', () => {
    const opaque = 'abc123def456ghi789';
    const raw = `/llm https://api.example.com ${opaque} mymodel`;
    const r = maskApiKeysInText(raw);
    expect(r.display).toContain('sk-***' + opaque.slice(-4));
    expect(r.display).not.toContain(opaque);
    expect(restoreApiKeys(r.display, r.restorations)).toBe(raw);
  });

  it('裸露的 sk- key（不在 /llm 命令里）也脱敏', () => {
    const raw = `这是密钥 ${KEY} 请保存`;
    const r = maskApiKeysInText(raw);
    expect(r.display).toBe(`这是密钥 ${tokenOf(KEY)} 请保存`);
    expect(restoreApiKeys(r.display, r.restorations)).toBe(raw);
  });

  it('中文紧邻 sk- key 也能命中（不依赖单词边界）', () => {
    const raw = `密钥${KEY}，别外传`;
    const r = maskApiKeysInText(raw);
    expect(r.display).toContain(tokenOf(KEY));
    expect(restoreApiKeys(r.display, r.restorations)).toBe(raw);
  });

  it('多个 key 按出现顺序脱敏并全部还原', () => {
    const k2 = 'sk-ZZZZZZZZZZZZ5678';
    const raw = `/llm url ${KEY} ${k2} extra`;
    const r = maskApiKeysInText(raw);
    expect(r.display).toContain(tokenOf(KEY));
    expect(r.display).toContain(tokenOf(k2));
    expect(r.restorations).toHaveLength(2);
    expect(restoreApiKeys(r.display, r.restorations)).toBe(raw);
  });

  it('两个 key 末 4 位相同也能各自正确还原', () => {
    const a = 'sk-AAAAAAAAAAAA1111';
    const b = 'sk-BBBBBBBBBBBB1111';
    const raw = `${a} 和 ${b}`;
    const r = maskApiKeysInText(raw);
    // 两个 token 相同
    expect(r.display).toBe(`${tokenOf(a)} 和 ${tokenOf(a)}`);
    expect(restoreApiKeys(r.display, r.restorations)).toBe(raw);
  });

  it('短 key（<=4）走 maskApiKey 的 **** 形态', () => {
    const raw = '/llm https://api.example.com abcd m';
    const r = maskApiKeysInText(raw);
    expect(r.display).toBe('/llm https://api.example.com **** m');
    expect(restoreApiKeys(r.display, r.restorations)).toBe(raw);
  });

  it('还原表为空时 restoreApiKeys 原样返回', () => {
    expect(restoreApiKeys('/llm url sk-***1234 m', [])).toBe('/llm url sk-***1234 m');
  });
});

describe('光标保持', () => {
  it('光标在 key 之后：替换变短后相应前移', () => {
    const raw = `/llm url ${KEY} `;
    const caret = raw.length; // 想继续输入 model
    const r = maskApiKeysInText(raw, caret);
    expect(r.caret).toBe(r.display.length);
    expect(restoreApiKeys(r.display, r.restorations)).toBe(raw);
  });

  it('光标在 key 之后且后面还有文本：前移量 = 长度差', () => {
    const raw = `/llm url ${KEY} mymodel`;
    const caret = raw.length;
    const r = maskApiKeysInText(raw, caret);
    expect(r.caret).toBe(caret - (KEY.length - r.restorations[0]!.token.length));
  });

  it('光标在 key 内部：贴到 token 末尾', () => {
    const raw = `前缀${KEY}后缀`;
    const caret = '前缀'.length + 5;
    const r = maskApiKeysInText(raw, caret);
    expect(r.caret).toBe('前缀'.length + r.restorations[0]!.token.length);
  });

  it('无 key 时光标不变', () => {
    expect(maskApiKeysInText('随便聊聊', 3).caret).toBe(3);
  });
});

describe('pruneRestorations / 队列式还原', () => {
  it('删掉一个已脱敏 key 后，还原表丢弃对应项', () => {
    const k1 = 'sk-AAAAAAAAAAAA1111';
    const k2 = 'sk-BBBBBBBBBBBB2222';
    let r = maskApiKeysInText(`/llm url ${k1} ${k2}`);
    // 用户删掉第一个 token
    const display = r.display.replace(r.restorations[0]!.token + ' ', '');
    const kept = pruneRestorations(display, r.restorations);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.raw).toBe(k2);
    expect(restoreApiKeys(display, kept)).toBe(`/llm url ${k2}`);
  });

  it('末 4 位相同的多 key 仍按出现顺序还原', () => {
    const a = 'sk-AAAAAAAAAAAA1111';
    const b = 'sk-BBBBBBBBBBBB1111';
    const raw = `${a} ${b}`;
    const r = maskApiKeysInText(raw);
    expect(restoreApiKeys(r.display, r.restorations)).toBe(raw);
  });

  it('还原表为空时原样返回', () => {
    expect(restoreApiKeys('/llm url sk-***1234 m', [])).toBe('/llm url sk-***1234 m');
  });
});
