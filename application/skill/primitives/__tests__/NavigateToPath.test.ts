/** navigate_to 链接构造单测（纯函数，不依赖 DOM / 网络） */
import { describe, it, expect } from 'vitest';
import {
  isValidNavigateToPath, sanitizeNavigateToQuery, buildNavigateToPath,
  registerNavigateToPath, resolveNavigateToPath, navigateToObservation,
  NAVIGATE_LINK_SCHEME,
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

describe('短链注册表（修复 & 被 safeReply 转义导致参数丢失）', () => {
  it('登记真实带参路径 → token 不含 & / % / 中文，可反解回原路径', () => {
    const p = '/puzzle/index.html?type=%E5%AE%98%E5%AD%90&difficulty=3K';
    const token = registerNavigateToPath(p);
    expect(token).toMatch(/^[a-z0-9-]+$/);
    expect(resolveNavigateToPath(token)).toBe(p);
  });

  it('未知 token 返回 null', () => {
    expect(resolveNavigateToPath('never-registered')).toBeNull();
  });

  it('observation 只有 nav: 短链，绝不出现真实 URL 或裸 &', () => {
    const p = '/puzzle/index.html?type=%E6%89%8B%E7%AD%8B&difficulty=8K';
    const token = registerNavigateToPath(p);
    const obs = navigateToObservation('做8K手筋题', token);
    expect(obs).toContain(`[做8K手筋题](${NAVIGATE_LINK_SCHEME}${token})`);
    expect(obs).not.toContain(p);
    expect(obs).not.toContain('&');
    expect(obs).toContain('原样');
  });

  it('标签里的方括号/换行被剔除，空标签回落', () => {
    const t = registerNavigateToPath('/puzzle/index.html');
    expect(navigateToObservation('[a]\nb', t)).toContain('[ab](');
    expect(navigateToObservation('  ', t)).toContain('[打开页面](');
  });

  it('回归：safeReply 对短链无害（不含 &，不会生成 &amp; 实体）', () => {
    const t = registerNavigateToPath('/puzzle/index.html?type=x&difficulty=3K');
    const obs = navigateToObservation('做题', t);
    const safe = obs.replace(/&/g, '&amp;');
    expect(safe).toBe(obs); // 没有任何 & 可转，短链天然免疫
  });
});
