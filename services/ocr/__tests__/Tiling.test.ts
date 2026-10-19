import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { planTiles, dedupeItems, mergeFragments, mergeTileResults } from '../Tiling';
import type { OcrItem } from '../types';

/** 从真实 OCR dump 构造 OcrItem（poly → x/y/w/h） */
function loadReal(path: string, yOffset = 0): OcrItem[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Array<{
    text: string; poly: number[][]; score: number;
  }>;
  return raw.map((it) => {
    const xs = it.poly.map((p) => p[0]!);
    const ys = it.poly.map((p) => p[1]!);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    return {
      text: it.text, score: it.score,
      x: minX, y: minY + yOffset, w: maxX - minX, h: maxY - minY,
    };
  });
}

describe('planTiles', () => {
  it('短图不分片', () => {
    expect(planTiles(500, 900, 60)).toEqual([{ y0: 0, y1: 500 }]);
  });

  it('长图分片且相邻片有重叠', () => {
    const t = planTiles(6038, 900, 60);
    expect(t.length).toBeGreaterThan(1);
    // 覆盖完整
    expect(t[0]!.y0).toBe(0);
    expect(t[t.length - 1]!.y1).toBe(6038);
    // 相邻重叠 = 60
    for (let i = 1; i < t.length; i++) {
      expect(t[i]!.y0).toBe(t[i - 1]!.y1 - 60);
    }
  });

  it('重叠不超过片高一半', () => {
    const t = planTiles(2000, 900, 800); // 重叠被钳到 450
    for (let i = 1; i < t.length; i++) {
      expect(t[i]!.y0).toBe(t[i - 1]!.y1 - 450);
    }
  });
});

describe('真实数据：碎片合并', () => {
  const items = loadReal(resolve(__dirname, 'fixture-items-full.json'));

  it('整图 OCR 里「孙」「超」是两个块', () => {
    expect(items.some((i) => i.text === '孙')).toBe(true);
    expect(items.some((i) => i.text === '超')).toBe(true);
  });

  it('合并后得到「孙超」且不再有单字碎片', () => {
    const merged = mergeFragments(items);
    expect(merged.some((i) => i.text === '孙超')).toBe(true);
    expect(merged.some((i) => i.text === '孙')).toBe(false);
    expect(merged.some((i) => i.text === '超')).toBe(false);
  });

  it('「王崇」正确拼序（检测框是颠倒的：崇在左）', () => {
    const merged = mergeFragments(items);
    const t = merged.find((i) => i.text === '王崇' || i.text === '崇王');
    expect(t?.text).toBe('王崇');
  });

  it('不误并跨两行的单位名（台州市总工会 / 代表队）', () => {
    const merged = mergeFragments(items);
    // 这两个块纵向错开两行，绝不能合成一个
    expect(merged.some((i) => i.text.includes('台州市总工会') && i.text.includes('代表队'))).toBe(false);
    // 它们本身应各自保留
    expect(merged.some((i) => i.text === '台州市总工会')).toBe(true);
    expect(merged.some((i) => i.text === '代表队')).toBe(true);
  });

  it('不误并多字单位名（浙江衢州衢江 / 总工会一队）', () => {
    const merged = mergeFragments(items);
    expect(merged.some((i) => i.text.includes('浙江衢州衢江') && i.text.includes('总工会'))).toBe(false);
  });

  it('块数只减不增，且减少量很小（只并碎片）', () => {
    const merged = mergeFragments(items);
    expect(merged.length).toBeLessThan(items.length);
    expect(items.length - merged.length).toBeLessThanOrEqual(10);
  });
});

describe('dedupeItems', () => {
  it('去掉重叠区重复识别的同一块', () => {
    const a: OcrItem = { text: '杭州市总工会', score: 0.9, x: 100, y: 200, w: 120, h: 30 };
    const b: OcrItem = { text: '杭州市总工会', score: 0.99, x: 101, y: 201, w: 120, h: 30 };
    const out = dedupeItems([a, b]);
    expect(out.length).toBe(1);
    expect(out[0]!.score).toBe(0.99); // 保留置信度高的
  });

  it('不删同文字但位置很远的块（表里很多 0 和 代表队）', () => {
    const a: OcrItem = { text: '0', score: 0.9, x: 350, y: 100, w: 20, h: 20 };
    const b: OcrItem = { text: '0', score: 0.9, x: 350, y: 3000, w: 20, h: 20 };
    expect(dedupeItems([a, b]).length).toBe(2);
  });
});

describe('mergeTileResults', () => {
  it('还原 y 偏移并按 scale 除回原尺度', () => {
    const out = mergeTileResults(
      [{ y0: 2900, items: [{ text: '孙超', score: 1, x: 506, y: 240, w: 74, h: 33 }] }],
      2
    );
    expect(out.length).toBe(1);
    expect(out[0]!.y).toBeCloseTo((240 + 2900) / 2);
  });
});
