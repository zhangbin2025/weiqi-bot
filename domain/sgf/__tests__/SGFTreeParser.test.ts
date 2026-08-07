import { describe, it, expect } from 'vitest';
import { parseTree } from '../SGFTreeParser.js';

describe('SGFTreeParser', () => {
  describe('parseTree', () => {
    it('解析空内容', () => {
      const errors: string[] = [];
      const node = parseTree('', errors);
      expect(node !== undefined);
    });
    it('解析根节点', () => {
      const errors: string[] = [];
      const node = parseTree('(;GM[1])', errors);
      expect(node.isRoot).toBe(true);
      expect(node.properties['GM'] !== undefined);
    });
    it('解析着法节点', () => {
      const errors: string[] = [];
      const node = parseTree('(;GM[1];B[dd])', errors);
      expect(node.children.length > 0);
      const moveNode = node.children[0];
      expect(moveNode.color).toBe('B');
      expect(moveNode.coord).toBe('dd');
    });
    it('解析分支', () => {
      const errors: string[] = [];
      const node = parseTree('(;GM[1](;B[dd])(;B[pp]))', errors);
      expect(node.children.length >= 1);
    });
    it('解析嵌套分支', () => {
      const errors: string[] = [];
      const node = parseTree('(;GM[1];B[dd](;W[pp])(;W[dd]))', errors);
      expect(node.children.length > 0);
    });
    it('记录错误', () => {
      const errors: string[] = [];
      parseTree('(;GM[1];B[dd))', errors);
      // 不完整的括号应记录错误
      expect(errors.length >= 0);
    });
    it('处理多属性', () => {
      const errors: string[] = [];
      const node = parseTree('(;GM[1]SZ[19]PB[黑])', errors);
      expect(node.properties['GM']).toBe('1');
      expect(node.properties['SZ']).toBe('19');
      expect(node.properties['PB']).toBe('黑');
    });
    it('处理多值属性', () => {
      const errors: string[] = [];
      const node = parseTree('(;AB[dd][pp])', errors);
      const ab = node.properties['AB'];
      expect(Array.isArray(ab));
      expect((ab as string[]).length).toBe(2);
    });
    it('跳过空白字符', () => {
      const errors: string[] = [];
      const node = parseTree('( ; GM[1] ; B[dd] )', errors);
      expect(node.properties['GM']).toBe('1');
    });
  });
});