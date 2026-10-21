/**
 * KataGo 归档棋谱 URL（katago://）识别回归
 * @module domain/intent/__tests__/katagoUrl
 * @description
 *   决策（2026-10-21）：katago://date/YYYY-MM-DD[/index] 与 lib:// 地位相同 ——
 *   assistant 识别到即触发「下载棋谱」跳转 fetcher 抓取；
 *   浏览器里打不开（伪协议），UI 只做描述展示 + 复制，不做外链跳转。
 *
 *   背景：GAME_URL_REGEX 原先只认 https? 与 lib，katago:// 落空后退化到
 *   LLM 评分分类，导致扫码/输入 katago 链接时意图判不准（识别成 help）。
 */
import { describe, it, expect } from 'vitest';
import {
  GAME_URL_REGEX,
  KATAGO_URL_REGEX,
  isGameUrl,
  isKatagoUrl,
  isLibUrl,
  extractKatagoUrl,
  parseKatagoUrl,
  describeKatagoUrl,
} from '../libUrl';

describe('katago:// 可抓取链接识别', () => {
  it('isGameUrl 认 katago://（与 lib://、http(s) 同等地位）', () => {
    expect(isGameUrl('katago://date/2026-10-17/0')).toBe(true);
    expect(isGameUrl('katago://date/2026-10-17')).toBe(true);
    // 原有协议不受影响
    expect(isGameUrl('lib://ai-review/2026-10-13/0')).toBe(true);
    expect(isGameUrl('https://h5.foxwq.com/yehunewshare/?chessid=1')).toBe(true);
    expect(isGameUrl('随便一句话')).toBe(false);
  });

  it('isKatagoUrl 只认 katago://，不误伤 lib:// 与 http(s)', () => {
    expect(isKatagoUrl('katago://date/2026-10-17/0')).toBe(true);
    expect(isKatagoUrl('lib://ai-review/2026-10-13/0')).toBe(false);
    expect(isKatagoUrl('https://example.com/g/1')).toBe(false);
    expect(isLibUrl('katago://date/2026-10-17/0')).toBe(false);
  });

  it('GAME_URL_REGEX 提取时保留完整 index，不吃掉 /N', () => {
    const m = 'katago://date/2026-10-17/5'.match(GAME_URL_REGEX);
    expect(m?.[0]).toBe('katago://date/2026-10-17/5');
  });

  it('从句子中提取 katago 链接', () => {
    expect(extractKatagoUrl('帮我校 katago://date/2026-10-17/0 这盘棋')).toBe(
      'katago://date/2026-10-17/0',
    );
    expect(extractKatagoUrl('没有链接')).toBeNull();
    expect(extractKatagoUrl(undefined)).toBeNull();
  });

  it('KATAGO_URL_REGEX 与 GAME_URL_REGEX 对齐 katago 协议', () => {
    expect(KATAGO_URL_REGEX.test('katago://date/2026-10-17/0')).toBe(true);
    expect(GAME_URL_REGEX.source).toContain('katago');
  });
});

describe('katago:// 解析与描述', () => {
  it('解析出日期与下标，缺省下标为 0', () => {
    expect(parseKatagoUrl('katago://date/2026-10-17/5')).toEqual({
      date: '2026-10-17',
      index: 5,
    });
    expect(parseKatagoUrl('katago://date/2026-10-17')).toEqual({
      date: '2026-10-17',
      index: 0,
    });
  });

  it('非法格式返回 null', () => {
    expect(parseKatagoUrl('katago://bad')).toBeNull();
    expect(parseKatagoUrl('https://example.com')).toBeNull();
  });

  it('描述为可读文案，下标按人类习惯从 1 开始', () => {
    expect(describeKatagoUrl('katago://date/2026-10-17/0')).toBe('KataGo 2026-10-17 #1');
    expect(describeKatagoUrl('katago://date/2026-10-17/5')).toBe('KataGo 2026-10-17 #6');
    // 解析不了就原样返回，不丢信息
    expect(describeKatagoUrl('katago://bad')).toBe('katago://bad');
  });
});
