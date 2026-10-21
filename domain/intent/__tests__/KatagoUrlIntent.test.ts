/**
 * 端到端：katago:// 链接被识别为「下载棋谱」意图
 * @module domain/intent/__tests__/KatagoUrlIntent
 * @description
 *   这是本次需求的落点：扫码/输入 katago://date/YYYY-MM-DD/N 后，
 *   assistant 要像内置棋谱（lib://）一样命中 url_download 规则，
 *   带着完整 url 跳转 fetcher 自动下载 —— 而不是退化成 LLM 评分判成 help。
 */
import { describe, it, expect } from 'vitest';
import { IntentRecognizer } from '../IntentRecognizer';
import { SPECIAL_RULES } from '../SpecialRules';

function recognize(text: string) {
  return new IntentRecognizer().recognize(text);
}

describe('katago:// 意图识别', () => {
  it('裸链接命中 url_download 规则，url 参数完整', () => {
    const r = recognize('katago://date/2026-10-17/0');
    expect(r.intent).toBe('download_game');
    expect(r.matchedRule).toBe('url_download');
    expect(r.params['url']).toBe('katago://date/2026-10-17/0');
  });

  it('带 index 的链接不丢下标（/5 不能变成 /0 或空）', () => {
    const r = recognize('katago://date/2026-10-17/5');
    expect(r.params['url']).toBe('katago://date/2026-10-17/5');
  });

  it('省略 index 的链接同样识别', () => {
    const r = recognize('katago://date/2026-10-17');
    expect(r.intent).toBe('download_game');
    expect(r.params['url']).toBe('katago://date/2026-10-17');
  });

  it('夹在中文句子里也能识别（扫码后用户可能补一句说明）', () => {
    const r = recognize('帮我校 katago://date/2026-10-17/0 这盘棋');
    expect(r.intent).toBe('download_game');
    expect(r.params['url']).toBe('katago://date/2026-10-17/0');
  });

  it('与 lib://、http(s) 走同一条规则，地位一致', () => {
    for (const url of [
      'katago://date/2026-10-17/0',
      'lib://ai-review/2026-10-13/0',
      'https://h5.foxwq.com/yehunewshare/?chessid=1',
    ]) {
      const r = recognize(url);
      expect(r.intent, url).toBe('download_game');
      expect(r.matchedRule, url).toBe('url_download');
      expect(r.params['url'], url).toBe(url);
    }
  });

  it('url_download 规则描述已覆盖 katago', () => {
    const rule = SPECIAL_RULES.find(r => r.name === 'url_download');
    expect(rule).toBeDefined();
    expect(rule!.description).toContain('katago');
  });
});
