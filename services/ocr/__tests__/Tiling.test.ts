import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  planTiles,
  planTiles2D,
  planColumns,
  dedupeItems,
  mergeFragments,
  mergeTileResults,
} from '../Tiling';
import { buildTable } from '../TableBuilder';
import type { OcrItem } from '../types';

/** 与 PaddleOcrJsEngine 保持一致（引擎内未导出，此处复刻） */
const TILE_HEIGHT = 900;
const TILE_OVERLAP = 60;

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

describe('碎片合并：间隙阈值与字符类型限定（2026-10-20 修复「田源」只剩「田」）', () => {
  /**
   * 用户报告：图片里是「田源」（两字中间有空格），解析出来只剩单字「田」。
   *
   * 根因：minOverlap 默认 -8（只容忍 8px 间隙），而实测被拆的双字名
   *       间隙是 13~14px，全部卡在条件②被否掉。这五对只是「靠运气」活着
   *       —— 两碎片中心距够近，被 buildTable 归进同一列拼接；间距再大
   *       就落进不同列，第二个字被丢到隔壁列。
   *
   * 修复：minOverlap 放宽到 -20（碎片间隙 14px，正常列最小间隙 31px，
   *       20 落在两者之间）+ 新增条件⑤「两侧必须都是纯汉字」。
   */
  const tiled = () => dedupeItems(loadRaw(resolve(__dirname, 'fixture-items-tiled.json')));

  it('间隙 13~14px 的双字名碎片必须被合并（旧阈值 -8 会漏掉全部五对）', () => {
    const merged = mergeFragments(tiled());
    for (const full of ['郭晖', '郑刚', '林斌', '莫凡', '胡啸']) {
      expect(merged.some((i) => i.text === full)).toBe(true);
    }
  });

  it('合并后姓名区不再残留单字碎片', () => {
    const merged = mergeFragments(tiled());
    const inName = (i: OcrItem) => {
      const cx = i.x + i.w / 2;
      return i.y >= 1900 && ((cx > 237 && cx < 330) || (cx > 500 && cx < 596));
    };
    const leftover = merged.filter((i) => inName(i) && /^[一-龥]$/.test(i.text));
    expect(leftover.map((i) => i.text)).toEqual([]);
  });

  it('条件⑤：数字列绝不参与合并（台号 36 + 编号 71 不得变成 3671）', () => {
    // 放宽间隙后，台号列与编号列的间隙（13px）正好也落进阈值，
    // 仅靠几何无法与被拆的姓名碎片区分，必须靠字符类型切开。
    const src: OcrItem[] = [
      { text: '36', score: 1, x: 6, y: 1885, w: 34, h: 34 },
      { text: '71', score: 1, x: 53, y: 1885, w: 36, h: 34 },
    ];
    const out = mergeFragments(src);
    expect(out.length).toBe(2);
    expect(out.map((i) => i.text).sort()).toEqual(['36', '71']);
  });

  it('条件⑤：汉字碎片仍可合并（与上一用例几何相同，结果必须相反）', () => {
    const src: OcrItem[] = [
      { text: '郭', score: 1, x: 248, y: 4721, w: 25, h: 23 },
      { text: '晖', score: 1, x: 286, y: 4721, w: 26, h: 23 },
    ];
    const out = mergeFragments(src);
    expect(out.length).toBe(1);
    expect(out[0]!.text).toBe('郭晖');
  });

  it('放宽后不得新增数字串误并（整图 fixture 全量校验）', () => {
    const full = loadReal(resolve(__dirname, 'fixture-items-full.json'));
    const merged = mergeFragments(full);
    // 台号/编号最多 3 位；出现 4 位以上纯数字说明把两列并成了一串
    const bad = merged.filter((i) => /^\d{4,}$/.test(i.text));
    expect(bad.map((i) => i.text)).toEqual([]);
  });

  it('放宽后不得在姓名区产生 5 字以上的误并', () => {
    const merged = mergeFragments(tiled());
    const bad = merged.filter((i) => {
      const cx = i.x + i.w / 2;
      return (
        i.y >= 1900 &&
        ((cx > 237 && cx < 330) || (cx > 500 && cx < 596)) &&
        /^[一-龥]{5,}$/.test(i.text)
      );
    });
    // '云蛇比赛编排' 是 OCR 直接识别出来的页脚，不是合并产物
    // （同 Tiling.test.ts 里另一条用例的说明），故排除。
    expect(bad.map((i) => i.text).filter((t) => t !== '云蛇比赛编排')).toEqual([]);
  });
});

describe('二维分片：横向也切（2026-10-20，根治「字被漏检」）', () => {
  /**
   * 根因：det 压的是**长边**（resizeLong=960/limitType="max"）。
   * canvas 宽 1542（原图 771 × scale 2）恒为长边，所以只调 TILE_HEIGHT
   * 对分辨率毫无影响（900/1200/1542 实测都是 14.3px）。必须横向也切，
   * 让 tile 变成 771×900（长边 900 < 960），det 才不缩放，字形提到 23px。
   */
  const CW = 1542;   // 原图 771 × scale 2
  const CH = 12076;  // 原图 6038 × scale 2

  it('横向切成 2 列，且相邻列有重叠（否则跨切点的字会被切成两半）', () => {
    const cols = planColumns(CW, TILE_OVERLAP, TILE_HEIGHT);
    expect(cols.length).toBe(2);
    // 第二列起点必须早于第一列终点，形成重叠
    expect(cols[1]!.x0).toBeLessThan(cols[0]!.x1);
  });

  it('全图无覆盖空洞（每个 x、每个 y 都至少被一片覆盖）', () => {
    const bands = planTiles2D(CW, CH, TILE_HEIGHT, TILE_OVERLAP);
    const covX = new Set<number>();
    const covY = new Set<number>();
    for (const b of bands) {
      for (let x = b.x0!; x < b.x1!; x++) covX.add(x);
      for (let y = b.y0; y < b.y1; y++) covY.add(y);
    }
    expect(covX.size).toBe(CW);
    expect(covY.size).toBe(CH);
  });

  it('每片长边都不超过 960（这是分辨率能提上去的前提）', () => {
    const bands = planTiles2D(CW, CH, TILE_HEIGHT, TILE_OVERLAP);
    for (const b of bands) {
      const w = b.x1! - b.x0!;
      const h = b.y1 - b.y0;
      expect(Math.max(w, h)).toBeLessThanOrEqual(960);
    }
  });

  it('各类宽度下都不出现覆盖空洞，且列宽不因重叠而超出 960', () => {
    for (const w of [960, 961, 1200, 1542, 1920, 2000, 2500, 3000, 4000]) {
      const cols = planColumns(w, TILE_OVERLAP, TILE_HEIGHT);
      const cov = new Set<number>();
      for (const c of cols) for (let x = c.x0; x < c.x1 && x < w; x++) cov.add(x);
      expect(cov.size, `宽度 ${w} 有空洞`).toBe(w);
      for (const c of cols) {
        // 列宽 + 与右邻列的重叠 不得超 960，否则 det 又会缩放（实测 1920 会变 1020）
        expect(c.x1 - c.x0, `宽度 ${w} 的列过宽`).toBeLessThanOrEqual(960);
      }
    }
  });

  it('已经够小的图不横切（避免白白翻倍片数）', () => {
    // 单列长边 = max(width, tileHeight) ≤ 960 时，det 本来就不缩放
    expect(planColumns(960, TILE_OVERLAP, TILE_HEIGHT).length).toBe(1);
    expect(planColumns(900, TILE_OVERLAP, TILE_HEIGHT).length).toBe(1);
  });

  it('mergeTileResults 能还原横向偏移（x0 是 canvas 坐标，要除 scale）', () => {
    // 第二列 x0=771(canvas) /2 = 385.5(原图)，片内 x=100 → 整图 x=485.5
    const out = mergeTileResults(
      [{ y0: 0, x0: 771, items: [{ text: '源', score: 1, x: 100, y: 50, w: 20, h: 20 }] }],
      2
    );
    expect(out[0]!.x).toBeCloseTo(485.5);
  });

  it('一维分片行为不变：x0 缺省时 x 原样保留', () => {
    const out = mergeTileResults(
      [{ y0: 0, items: [{ text: '田', score: 1, x: 239, y: 50, w: 23, h: 23 }] }],
      2
    );
    expect(out[0]!.x).toBe(239);
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
  /**
   * 生产契约（务必与 PaddleOcrJsEngine 对齐）：
   *   - items 来自 toItems(raw, scale)，**已除过 scale**，是原图坐标
   *   - y0 来自 planTiles(canvas.height, ...)，是**放大后 canvas 坐标**
   * 所以本函数只把 y0 除以 scale 后相加，不再对 x/y/w/h 二次缩放。
   */
  it('还原 y 偏移：y0 为 canvas 坐标，items 已是原图坐标', () => {
    const out = mergeTileResults(
      [{ y0: 2900, items: [{ text: '孙超', score: 1, x: 506, y: 240, w: 74, h: 33 }] }],
      2
    );
    expect(out.length).toBe(1);
    // y0=2900(canvas) /2 = 1450(原图) + 240(片内) = 1690
    expect(out[0]!.y).toBeCloseTo(1690);
    // items 已除过 scale，不得再除：x/w/h 原样保留
    expect(out[0]!.x).toBe(506);
    expect(out[0]!.w).toBe(74);
    expect(out[0]!.h).toBe(33);
  });

  it('坐标系回归：多片时各片偏移量一致（曾因二次除 scale 整体错位）', () => {
    // 原图 771×6038，宽<1200 → scale=2，canvas 高 12076
    const scale = 2;
    const canvasH = 12076;
    const bands = planTiles(canvasH, 900, 60);
    expect(bands.length).toBeGreaterThan(1);

    // 同一行文字落在第 k 片，还原后必须回到同一个原图 y
    for (const targetCanvasY of [6000, 3000, 9000]) {
      const bi = bands.findIndex((b) => targetCanvasY >= b.y0 && targetCanvasY < b.y1);
      const band = bands[bi]!;
      const tileCanvasY = targetCanvasY - band.y0;
      const item: OcrItem = {
        text: '测试',
        score: 1,
        x: 100,
        y: tileCanvasY / scale,
        w: 50,
        h: 25,
      };
      const out = mergeTileResults([{ y0: band.y0, items: [item] }], scale);
      expect(out[0]!.y).toBeCloseTo(targetCanvasY / scale);
    }
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
