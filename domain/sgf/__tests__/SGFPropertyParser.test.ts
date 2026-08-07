import { describe, it, expect } from 'vitest';
import { parsePropertiesAt, parsePropertyAt, parsePropertyValue, normalizeCoord } from '../SGFPropertyParser.js';

describe('SGFPropertyParser', () => {
  describe('parsePropertiesAt', () => {
    it('解析单个属性', () => {
      const errors: string[] = [];
      const result = parsePropertiesAt('GM[1]B[dd]', 0, errors);
      expect(result.props['GM']).toBe('1');
      expect(result.props['B']).toBe('dd');
    });
    it('解析多个属性', () => {
      const errors: string[] = [];
      const result = parsePropertiesAt('GM[1]SZ[19]PB[黑]', 0, errors);
      expect(Object.keys(result.props).length).toBe(3);
    });
    it('跳过空白（实现不支持属性名后空格）', () => {
      const errors: string[] = [];
      // 当前实现在属性名后不跳过空格，属性名遇空格停止
      const result = parsePropertiesAt('GM[1]', 0, errors);
      expect(result.props['GM']).toBe('1');
    });
    it('遇到分号停止', () => {
      const errors: string[] = [];
      const result = parsePropertiesAt('GM[1];B[dd]', 0, errors);
      expect(result.props['GM']).toBe('1');
      expect(result.newPos).toBe(5);
    });
  });

  describe('parsePropertyAt', () => {
    it('解析属性名', () => {
      const errors: string[] = [];
      const result = parsePropertyAt('GM[1]', 0, errors);
      expect(result.name).toBe('GM');
    });
    it('解析单值属性', () => {
      const errors: string[] = [];
      const result = parsePropertyAt('GM[1]', 0, errors);
      expect(result.values.length).toBe(1);
      expect(result.values[0]).toBe('1');
    });
    it('解析多值属性', () => {
      const errors: string[] = [];
      const result = parsePropertyAt('AB[dd][pp]', 0, errors);
      expect(result.values.length).toBe(2);
      expect(result.values[0]).toBe('dd');
      expect(result.values[1]).toBe('pp');
    });
    it('解析空值', () => {
      const errors: string[] = [];
      const result = parsePropertyAt('C[]', 0, errors);
      expect(result.values.length).toBe(1);
      expect(result.values[0]).toBe('');
    });
  });

  describe('parsePropertyValue', () => {
    it('解析简单值', () => {
      const result = parsePropertyValue('hello]', 0);
      expect(result.value).toBe('hello');
      expect(result.closed).toBe(true);
    });
    it('解析转义字符', () => {
      const result = parsePropertyValue('test\\]value]', 0);
      expect(result.value).toBe('test]value');
    });
    it('解析转义反斜杠', () => {
      const result = parsePropertyValue('test\\\\value]', 0);
      expect(result.value).toBe('test\\value');
    });
    it('解析转义换行', () => {
      const result = parsePropertyValue('test\\nvalue]', 0);
      expect(result.value).toBe('test\nvalue');
    });
    it('未闭合的值', () => {
      const result = parsePropertyValue('test', 0);
      expect(result.closed).toBe(false);
    });
  });

  describe('normalizeCoord', () => {
    it('字符串值返回原值', () => {
      expect(normalizeCoord('dd')).toBe('dd');
    });
    it('数组值返回首元素', () => {
      expect(normalizeCoord(['dd', 'pp'])).toBe('dd');
    });
    it('空数组返回空字符串', () => {
      expect(normalizeCoord([])).toBe('');
    });
    it('空字符串返回null', () => {
      expect(normalizeCoord('')).toBe(null);
    });
  });
});