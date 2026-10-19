import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { planTiles, dedupeItems, mergeFragments, mergeTileResults } from '../Tiling';
import { buildTable } from '../TableBuilder';
import type { OcrItem } from '../types';

/** 已是 OcrItem[] 形态的 dump，直接读 */
function loadRaw(path: string): OcrItem[] {
  return JSON.parse(readFileSync(path, 'utf8')) as OcrItem[];
}

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
    // 整图 fixture 有 974 块、碎片多，实测减少 38（约 4%）
    expect(items.length - merged.length).toBeLessThanOrEqual(50);
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

  it('分片后「余胜」被合并（间隙 6px 而非重叠，靠 minOverlap=-8 覆盖）', () => {
    // 必须先去重：相邻片重叠区会把同一处识别两次
    const merged = mergeFragments(dedupeItems(loadRaw(resolve(__dirname, 'fixture-items-tiled.json'))));
    expect(merged.some((i) => i.text === '余胜')).toBe(true);
  });

  it('合并是保守的：姓名列不新增 4 字以上的块', () => {
    const src = dedupeItems(loadRaw(resolve(__dirname, 'fixture-items-tiled.json')));
    const merged = mergeFragments(src);
    // 姓名列实测 x≈509~585；x≥595 起是白方团队列（本来就是长单位名）
    // 注意：不能直接断言「不存在 4 字以上块」—— 底部有个原生的
    // '云蛇比赛编排'(w/h=4.90) 是 OCR 直接识别出来的，不是合并产物。
    // 所以比较合并前后的差值：只允许减少，不允许增加。
    const count = (arr: OcrItem[]) =>
      arr.filter((i) => i.x > 500 && i.x < 586 && /^[\u4e00-\u9fa5]{4,}$/.test(i.text)).length;
    expect(count(merged)).toBeLessThanOrEqual(count(src));
  });

  it('不误并：白方团队列的多字单位名保持原样', () => {
    const merged = mergeFragments(dedupeItems(loadRaw(resolve(__dirname, 'fixture-items-tiled.json'))));
    const team = merged.filter((i) => i.x >= 595 && i.x < 630);
    // 仍应有大量多字单位名（说明没被拆散也没被乱并）
    expect(team.filter((i) => /^[\u4e00-\u9fa5]{3,}$/.test(i.text)).length).toBeGreaterThan(50);
  });
});

describe('单元格拼接与表外行过滤（2026-10-19 用户实测反馈）', () => {
  const tiled = () => dedupeItems(loadRaw(resolve(__dirname, 'fixture-items-tiled.json')));

  it('同一单元格里的多个块按 x 拼成整体（郭 + 晖 → 郭晖）', () => {
    // 根因：buildTable 早期版本「每列只保留置信度最高的块」，
    // 把同一格的 '晖' 丢掉 → 输出单字名 '郭'
    const grid = buildTable(mergeFragments(tiled()));
    const names = new Set(
      grid.cells.filter((c) => c.col === 4 || c.col === 7).map((c) => c.text)
    );
    for (const full of ['郭晖', '郑刚', '林斌', '莫凡', '胡啸']) {
      expect(names.has(full)).toBe(true);
    }
  });

  it('姓名列不再出现单字名', () => {
    const grid = buildTable(mergeFragments(tiled()));
    const single = grid.cells.filter(
      (c) => (c.col === 4 || c.col === 7) && /^[一-龥]$/.test(c.text)
    );
    expect(single.length).toBe(0);
  });

  it('空间包含的重复块去重（吕睿 与 睿 不拼成 吕睿睿）', () => {
    const out = dedupeItems(tiled());
    expect(out.some((i) => i.text === '吕睿睿')).toBe(false);
    // 保留更完整的那个（'吕睿' 比 '睿' 多一个字），即使后者置信度更高
    expect(out.some((i) => i.text === '吕睿')).toBe(true);
    expect(out.some((i) => i.text === '睿')).toBe(false);
  });

  it('等长近似重复也去重（陈思旷 / 陈忠旷）', () => {
    const out = dedupeItems(tiled());
    const both = out.filter((i) => i.text === '陈思旷' || i.text === '陈忠旷');
    expect(both.length).toBe(1);
  });

  it('不误删不同位置的同文本块（表里大量 0 和 代表队）', () => {
    const out = dedupeItems(tiled());
    // 编号列有很多 '0'，纵向分布很广，应大量保留
    expect(out.filter((i) => i.text === '0').length).toBeGreaterThan(50);
  });
});
