/**
 * 插件命名规则：用户指定优先，否则「规则1/规则2」简短命名且不撞车
 */
import { describe, it, expect } from 'vitest';
import {
  normalizePluginName,
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

describe('nextSimplePluginName', () => {
  it('空清单从规则1开始', () => {
    expect(nextSimplePluginName([])).toBe('规则1');
  });

  it('跳过已占用的编号', () => {
    expect(nextSimplePluginName(['规则1', '规则2'])).toBe('规则3');
    expect(nextSimplePluginName(['规则1', '规则3'])).toBe('规则2');
  });

  it('用户自定义名不占用编号，但同名「规则N」要跳过', () => {
    expect(nextSimplePluginName(['同分比胜局', '规则2'])).toBe('规则1');
    expect(nextSimplePluginName(['规则1', '同分比胜局'])).toBe('规则2');
  });
});

describe('resolvePluginName', () => {
  it('用户明确指定名字时原样使用', () => {
    expect(resolvePluginName('同分比胜局', [entry('规则1')])).toBe('同分比胜局');
  });

  it('没指定就自动排号，基于当前全部插件（工件中心，与会话无关）', () => {
    expect(resolvePluginName(undefined, [entry('规则1'), entry('规则2')])).toBe('规则3');
    expect(resolvePluginName('   ', [entry('规则1')])).toBe('规则2');
  });

  it('没有任何插件时第一个叫规则1', () => {
    expect(resolvePluginName(undefined, [])).toBe('规则1');
  });
});
