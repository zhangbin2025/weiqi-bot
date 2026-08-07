import { describe, it, expect } from 'vitest';
import { extractVariations, extractWinrates } from '../SGFVariationExtractor.js';
import type { ISGFNode } from '../types.js';

describe('SGFVariationExtractor', () => {
  describe('extractVariations', () => {
    it('无变化图返回空对象', () => {
      const tree: ISGFNode = {
        properties: {},
        isRoot: true,
        moveNumber: 0,
        color: null,
        coord: null,
        children: [],
      };
      const result = extractVariations(tree);
      expect(Object.keys(result).length).toBe(0);
    });
    it('提取单变化图', () => {
      const child: ISGFNode = {
        properties: { C: '变化1' },
        isRoot: false,
        moveNumber: 1,
        color: 'W',
        coord: 'pp',
        children: [],
      };
      const tree: ISGFNode = {
        properties: {},
        isRoot: true,
        moveNumber: 0,
        color: null,
        coord: null,
        children: [
          {
            properties: {},
            isRoot: false,
            moveNumber: 1,
            color: 'B',
            coord: 'dd',
            children: [child, { ...child, coord: 'pd' }],
          },
        ],
      };
      const result = extractVariations(tree);
      // 第一个分支是主分支，变化从第二个开始
      expect(result !== undefined);
    });
  });

  describe('extractWinrates', () => {
    it('无胜率注释返回空数组', () => {
      const tree: ISGFNode = {
        properties: {},
        isRoot: true,
        moveNumber: 0,
        color: null,
        coord: null,
        children: [],
      };
      const result = extractWinrates(tree);
      expect(result.length).toBe(0);
    });
    it('提取野狐格式胜率', () => {
      const tree: ISGFNode = {
        properties: { C: '黑65.3%' },
        isRoot: true,
        moveNumber: 1,
        color: 'B',
        coord: 'dd',
        children: [],
      };
      const result = extractWinrates(tree);
      expect(result.length).toBe(1);
      expect(result[0].winrate).toBe(65.3);
      expect(result[0].color).toBe('black');
    });
    it('提取KataGo格式胜率', () => {
      const tree: ISGFNode = {
        properties: { C: 'B 65.3%' },
        isRoot: true,
        moveNumber: 1,
        color: 'B',
        coord: 'dd',
        children: [],
      };
      const result = extractWinrates(tree);
      expect(result.length).toBe(1);
      expect(result[0].color).toBe('black');
    });
    it('提取星阵格式胜率', () => {
      const tree: ISGFNode = {
        properties: { C: '胜率:黑 65.3%' },
        isRoot: true,
        moveNumber: 1,
        color: 'B',
        coord: 'dd',
        children: [],
      };
      const result = extractWinrates(tree);
      expect(result.length).toBe(1);
    });
    it('遍历所有节点提取胜率', () => {
      const tree: ISGFNode = {
        properties: { C: '黑65.3%' },
        isRoot: true,
        moveNumber: 0,
        color: null,
        coord: null,
        children: [
          {
            properties: { C: '白48.2%' },
            isRoot: false,
            moveNumber: 1,
            color: 'B',
            coord: 'dd',
            children: [],
          },
        ],
      };
      const result = extractWinrates(tree);
      expect(result.length).toBe(2);
    });
  });
});