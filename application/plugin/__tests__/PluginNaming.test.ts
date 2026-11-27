/**
 * 开发工件自动命名：用户指定优先，否则插件「插件N」/ 技能「技能N」简短命名且不撞车
 */
import { describe, it, expect } from 'vitest';
import {
  normalizePluginName,
  nextNumberedName,
  nextSimplePluginName,
  resolvePluginName,
  MAX_PLUGIN_NAME_LENGTH,
} from '../PluginNaming';
import type { PluginContextEntry } from '@domain/plugin/types';

const entry = (name: string): PluginContextEntry => ({
  id: `plugin:${name}`, name, pointId: 'ranking',
  enabled: false, version: 1, intent: 'x',
});

describe('normalizePluginName', () => {
  it('用户给了名字就归一化后使用', () => {
    expect(normalizePluginName('  同分比胜局  ')).toBe('同分比胜局');
    expect(normalizePluginName('同分\n比胜局')).toBe('同分 比胜局');
  });

  it('空白 / 非字符串 / undefined 视为没指定', () => {
    expect(normalizePluginName('   ')).toBeUndefined();
    expect(normalizePluginName('')).toBeUndefined();
    expect(normalizePluginName(undefined)).toBeUndefined();
    expect(normalizePluginName(123 as unknown as string)).toBeUndefined();
  });

  it('超长名字按码点截断', () => {
    const long = '规'.repeat(MAX_PLUGIN_NAME_LENGTH + 10);
    expect([...normalizePluginName(long)!]).toHaveLength(MAX_PLUGIN_NAME_LENGTH);
  });
});

describe('nextNumberedName（插件 / 技能共用同一套排号，只由前缀区分类型）', () => {
  it('按前缀生成，空清单从 1 开始', () => {
    expect(nextNumberedName('插件', [])).toBe('插件1');
    expect(nextNumberedName('技能', [])).toBe('技能1');
  });

  it('跳过已占用的编号，且不同前缀互不影响', () => {
    expect(nextNumberedName('技能', ['技能1', '技能2'])).toBe('技能3');
    expect(nextNumberedName('技能', ['技能1', '技能3'])).toBe('技能2');
    expect(nextNumberedName('插件', ['技能1', '技能2'])).toBe('插件1');
  });
});

describe('nextSimplePluginName', () => {
  it('空清单从插件1开始', () => {
    expect(nextSimplePluginName([])).toBe('插件1');
  });

  it('跳过已占用的编号', () => {
    expect(nextSimplePluginName(['插件1', '插件2'])).toBe('插件3');
    expect(nextSimplePluginName(['插件1', '插件3'])).toBe('插件2');
  });

  it('用户自定义名不占用编号，但同名「插件N」要跳过', () => {
    expect(nextSimplePluginName(['同分比胜局', '插件2'])).toBe('插件1');
    expect(nextSimplePluginName(['插件1', '同分比胜局'])).toBe('插件2');
  });
});

describe('resolvePluginName', () => {
  it('用户明确指定名字时原样使用', () => {
    expect(resolvePluginName('同分比胜局', [entry('插件1')])).toBe('同分比胜局');
  });

  it('没指定就自动排号，基于当前全部插件（工件中心，与会话无关）', () => {
    expect(resolvePluginName(undefined, [entry('插件1'), entry('插件2')])).toBe('插件3');
    expect(resolvePluginName('   ', [entry('插件1')])).toBe('插件2');
  });

  it('没有任何插件时第一个叫插件1', () => {
    expect(resolvePluginName(undefined, [])).toBe('插件1');
  });
});
