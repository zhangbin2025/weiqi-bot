/** navigate_to 链接构造单测（纯函数，不依赖 DOM / 网络） */
import { describe, it, expect } from 'vitest';
import {
  isValidNavigateToPath, sanitizeNavigateToQuery, buildNavigateToPath,
  navigateToObservation,
} from '../NavigateToPath';

describe('sanitizeNavigateToQuery', () => {
  it('只保留非空字符串键值', () => {
    expect(sanitizeNavigateToQuery({ type: '手筋', difficulty: '8K' }))
      .toEqual({ type: '手筋', difficulty: '8K' });
  });

  it('忽略 null / 数字 / 嵌套对象 / 空键，并 trim 值', () => {
    expect(sanitizeNavigateToQuery({ a: 1, b: null, c: { x: 1 }, '': 'v', d: '  ', e: ' ok ' }))
      .toEqual({ e: 'ok' });
  });

  it('非对象入参返回空对象', () => {
    expect(sanitizeNavigateToQuery(null)).toEqual({});
    expect(sanitizeNavigateToQuery('x')).toEqual({});
    expect(sanitizeNavigateToQuery(['a'])).toEqual({});
  });
});

describe('buildNavigateToPath', () => {
  it('中文题型由宿主百分号编码，键顺序稳定', () => {
    expect(buildNavigateToPath('/puzzle/index.html', { type: '手筋', difficulty: '8K' }))
      .toBe('/puzzle/index.html?type=%E6%89%8B%E7%AD%8B&difficulty=8K');
  });

  it('无参数时原样返回 path', () => {
    expect(buildNavigateToPath('/puzzle/index.html', {})).toBe('/puzzle/index.html');
  });

  it('path 已有查询串时用 & 追加', () => {
    expect(buildNavigateToPath('/puzzle/index.html?source=lib-life-death', { difficulty: '3D' }))
      .toBe('/puzzle/index.html?source=lib-life-death&difficulty=3D');
  });

  it('空格被编码，不产生裸语法字符', () => {
    const p = buildNavigateToPath('/puzzle/index.html', { q: '手筋 and 8K' });
    expect(p).not.toContain(' ');
    expect(p).toContain('%E6%89%8B%E7%AD%8B');
  });
});

describe('isValidNavigateToPath', () => {
  it('放行站内绝对路径（含查询串）', () => {
    expect(isValidNavigateToPath('/puzzle/index.html')).toBe(true);
    expect(isValidNavigateToPath('/puzzle/index.html?type=%E6%89%8B%E7%AD%8B')).toBe(true);
  });

  it('拒绝相对路径 / 外链 / 路径穿越', () => {
    expect(isValidNavigateToPath('puzzle/index.html')).toBe(false);
    expect(isValidNavigateToPath('https://x.com/puzzle')).toBe(false);
    expect(isValidNavigateToPath('/puzzle/../index.html')).toBe(false);
  });
});

describe('navigateToObservation', () => {
  it('给一条可点 markdown 短链接，且不含裸路径复述', () => {
    const p = '/puzzle/index.html?type=%E6%89%8B%E7%AD%8B&difficulty=8K';
    const obs = navigateToObservation('做8K手筋题', p);
    expect(obs).toContain(`[做8K手筋题](${p})`);
    expect(obs).toContain('原样抄进回复');
  });

  it('标签里的方括号/换行被剔除，空标签回落', () => {
    expect(navigateToObservation('[a]\nb', '/puzzle/index.html')).toContain('[ab](');
    expect(navigateToObservation('  ', '/puzzle/index.html')).toContain('[打开页面](');
  });
});
