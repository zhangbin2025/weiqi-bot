/**
 * 可发布资源 id 命名规则：与 weiqi-assets/scripts/validate.mjs 的 ID_RE 同形。
 * 这不是新发明的阈值：只是锁定「宿主侧复述一份公开契约」这件事没有漂移。
 */
import { describe, it, expect } from 'vitest';
import {
  RESOURCE_ID_RE, isValidResourceId, normalizeResourceId,
} from '../ResourceId';

describe('ResourceId', () => {
  it('与原仓 ID_RE 逐字同形', () => {
    expect(RESOURCE_ID_RE.source).toBe('^[a-z0-9][a-z0-9._-]*$');
  });

  it('接受可读发布用 id', () => {
    for (const id of [
      'admin.publish', 'ranking.by-wins', 'weiqi-photo', 'user.a1b2c3',
      'a', '0', 'a.b_c-d', 'workflow-operator.x',
    ]) expect(isValidResourceId(id)).toBe(true);
  });

  it('拒绝随机插件 id / 中文 / 空格 / 大写 / 非法首字符', () => {
    for (const id of [
      'plugin:1000:aaa',   // 旧的生成式插件 id（含冒号）
      'user.中文-hash',    // 旧的中文 slug 技能 id
      'Bad:中文', '有空格 id', 'Upper.Case', '-leading', '.leading',
      '_leading', '', '   ', 'a/b', 'a@b',
    ]) expect(isValidResourceId(id)).toBe(false);
  });

  it('去首尾空白后校验，非字符串一律拒绝', () => {
    expect(isValidResourceId('  admin.publish  ')).toBe(true);
    expect(normalizeResourceId('  admin.publish  ')).toBe('admin.publish');
    expect(isValidResourceId(123)).toBe(false);
    expect(isValidResourceId(null)).toBe(false);
    expect(isValidResourceId(undefined)).toBe(false);
  });
});
