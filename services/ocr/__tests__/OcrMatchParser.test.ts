/**
 * OCR 对阵表解析测试
 *
 * fixture 来自真实引擎输出（PP-OCRv5 mobile，WASM，真实 Chrome）：
 *   输入 509×1955 的围棋锦标赛对阵表，检出 348 个文本块。
 *   对应的正确答案在 services/ocr/__tests__/expected.csv（43 行对阵）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildTable, clusterRows, detectColumns, inferRowTolerance } from '../TableBuilder';
import { parseOcrResult } from '../OcrMatchParser';
import type { OcrItem } from '../types';

const DIR = __dirname;

/** 真实 OCR 输出（348 个文本块，带坐标） */
function loadFixture(): OcrItem[] {
  const raw = readFileSync(resolve(DIR, 'fixture-items.json'), 'utf-8');
  return JSON.parse(raw) as OcrItem[];
}

/** 正确答案：43 行对阵（人工校对版） */
function loadExpected(): string[][] {
  const raw = readFileSync(resolve(DIR, 'expected.csv'), 'utf-8').replace(/^﻿/, '');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(1) // 去表头
    .map((l) => l.split(',').map((c) => c.replace(/^"|"$/g, '')));
}

describe('OCR 真实样本：表格重建', () => {
  const items = loadFixture();

  it('fixture 应当包含 348 个文本块', () => {
    expect(items).toHaveLength(348);
    expect(items[0]!.text).toBe('2026年浦东新区围棋锦标赛');
  });

  it('行容差推断应落在合理区间（能区分行内抖动与行距）', () => {
    const tol = inferRowTolerance(items);
    expect(tol).toBeGreaterThanOrEqual(10);
    expect(tol).toBeLessThanOrEqual(45);
  });

  it('行聚类应还原出 47 行（43 数据行 + 标题 + 表头 + 单位行）', () => {
    const rows = clusterRows(items);
    expect(rows.length).toBe(47);
  });

  it('列检测应得到 8 列（标题行不得污染列切分）', () => {
    const grid = buildTable(items);
    expect(grid.columnCount).toBe(8);
  });

  it('首行数据应还原出正确的对阵', () => {
    const grid = buildTable(items);
    // 行布局：0=大标题 1=轮次标题 2=表头 3=子表头(和公/和分) 4=第一条数据
    expect(grid.cells.filter((c) => c.row === 3).map((c) => c.text).sort())
      .toEqual(['和公', '和分']);
    const first = grid.cells.filter((c) => c.row === 4).sort((a, b) => a.col - b.col);
    expect(first.map((c) => c.text)).toEqual(['1', '6', '陈智洋', '12', ':', '12', '刘志文', '39']);
  });
});

describe('OCR 真实样本：对阵解析（对照 43 行正确答案）', () => {
  const items = loadFixture();
  const expected = loadExpected();

  it('应解析出 43 场对阵，且姓名与正确答案完全一致', () => {
    const result = parseOcrResult(items, 7);

    expect(result.warnings).toEqual([]);
    expect(result.matches).toHaveLength(43);

    const mismatches: string[] = [];
    expected.forEach((row, i) => {
      const m = result.matches[i];
      if (!m) {
        mismatches.push(`第${i + 1}行缺失`);
        return;
      }
      // expected 列序：台号,黑方编号,黑方姓名,黑方上轮分,成绩,白方上轮分,白方姓名,白方编号
      if (m.p1Name !== row[2]) mismatches.push(`第${i + 1}行黑方: 期望${row[2]} 实际${m.p1Name}`);
      if (m.p2Name !== row[6]) mismatches.push(`第${i + 1}行白方: 期望${row[6]} 实际${m.p2Name}`);
    });

    expect(mismatches).toEqual([]);
  });

  it('应还原出 43 个选手的上轮累计分，供 recalcWinLoss 做差分', () => {
    const result = parseOcrResult(items, 7);
    // 43 场 × 2 人 = 86 条，重名极少，允许少量合并
    expect(Object.keys(result.pdfScores).length).toBeGreaterThanOrEqual(84);

    expected.forEach((row) => {
      const black = row[2]!;
      const white = row[6]!;
      if (result.pdfScores[black] !== undefined) {
        expect(result.pdfScores[black]).toBe(+row[3]!);
      }
      if (result.pdfScores[white] !== undefined) {
        expect(result.pdfScores[white]).toBe(+row[5]!);
      }
    });
  });

  it('应从表头文本识别出比赛名称 / 分组 / 轮次', () => {
    const result = parseOcrResult(items, 7);
    expect(result.title).toBe('2026年浦东新区围棋锦标赛');
    expect(result.groupName).toBe('青少年组');
    expect(result.roundLabel).toBe('第7轮');
  });

  it('应给出识别质量统计（低置信度块数）', () => {
    const result = parseOcrResult(items, 7);
    expect(result.stats.itemCount).toBe(348);
    expect(result.stats.avgScore).toBeGreaterThan(0.85);
    expect(result.stats.columnCount).toBe(8);
  });
});

describe('OCR 边界情况', () => {
  it('空输入应给出明确告警而非抛错', () => {
    const result = parseOcrResult([], 1);
    expect(result.matches).toEqual([]);
    expect(result.warnings).toContain('未从图片中识别到任何文本');
  });

  it('无规律的散乱文本应告警而不是编造对阵', () => {
    const junk: OcrItem[] = [
      { text: '你好', score: 0.9, x: 0, y: 0, w: 20, h: 10 },
      { text: '世界', score: 0.9, x: 100, y: 0, w: 20, h: 10 },
    ];
    const result = parseOcrResult(junk, 1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
