/**
 * OCR 对阵表解析器
 * @module services/ocr/OcrMatchParser
 *
 * 把重建后的表格网格转成项目统一的对阵数据结构，
 * 与 services/pdf/PdfMatchParser.ts 的输出保持同一契约，
 * 从而复用 PdfEventService.importRound 与 recalcWinLoss 的整套后续逻辑。
 */

import type { Match } from '../event/types';
import type { OcrItem, TableGrid } from './types';
import { buildTable, cellText } from './TableBuilder';
import { assignColumnRoles, pickColumn, type ColumnAssignment } from './ColumnRoles';

/** 解析出的单轮对阵（与 PdfRoundResult 对齐） */
export interface OcrRoundResult {
  /** 比赛名称（从表头文本猜，可能为空） */
  title?: string | undefined;
  /** 分组名（可能为空） */
  groupName?: string | undefined;
  /** 轮次（从文本「第N轮」猜，可能为空） */
  roundLabel?: string | undefined;
  /** 该轮对阵 */
  matches: Match[];
  /** 姓名 → 该表上显示的累计分（供 recalcWinLoss 做差分） */
  pdfScores: Record<string, number>;
  /** 解析告警 */
  warnings: string[];
  /** 识别元信息 */
  stats: {
    rowCount: number;
    columnCount: number;
    itemCount: number;
    /** 平均置信度 */
    avgScore: number;
    /** 低置信度（<0.85）的文本块数 */
    lowScoreCount: number;
    /** 列角色判定详情，便于排查 */
    columnRoles: ColumnAssignment[];
  };
}

const RE_TITLE = /\d{4}年.*?(锦标赛|联赛|杯赛|邀请赛|公开赛|比赛|赛)/;
// 注意：「青少」「幼儿」等前缀必须列全，否则会把「青少年组」截成「少年组」
const RE_GROUP =
  /((?:青少年|青年|少年|儿童|幼儿|初中|高中|大学|成年|成人|老年|男子|女子|公开|业余|职业)[^第]{0,8}?组)/;
const RE_ROUND = /第\s*(\d+)\s*轮/;

/** 尝试把文本转成数字，失败返回 null */
function toInt(s: string): number | null {
  const t = s.trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  return +t;
}

/**
 * 从整个表格的文本里猜标题 / 分组 / 轮次
 * 表头行与标题行通常位于最上方若干行
 */
function extractMeta(grid: TableGrid, warnings: string[]): {
  title?: string | undefined;
  groupName?: string | undefined;
  roundLabel?: string | undefined;
} {
  const lines: string[] = [];
  for (let r = 0; r < Math.min(grid.rowCount, 6); r++) {
    const cells = grid.columns.map((c) => cellText(grid, r, c.index)).filter(Boolean);
    if (cells.length) lines.push(cells.join(' '));
  }
  const all = lines.join('\n');
  if (!all.trim()) warnings.push('未识别到表头文本，无法推断比赛名称与轮次');

  const tm = all.match(RE_TITLE);
  const gm = all.match(RE_GROUP);
  const rm = all.match(RE_ROUND);

  return {
    ...(tm ? { title: tm[0].trim() } : {}),
    ...(gm ? { groupName: gm[1]!.trim() } : {}),
    ...(rm ? { roundLabel: `第${rm[1]!}轮` } : {}),
  };
}

/**
 * 解析 OCR 结果
 * @param items OCR 文本块（原始图片坐标）
 * @param defaultRound 无法从文本推断轮次时使用的轮次
 */
export function parseOcrResult(items: OcrItem[], defaultRound: number): OcrRoundResult {
  const warnings: string[] = [];
  const grid = buildTable(items);

  if (grid.rowCount === 0) {
    return {
      matches: [],
      pdfScores: {},
      warnings: ['未从图片中识别到任何文本'],
      stats: {
        rowCount: 0,
        columnCount: 0,
        itemCount: 0,
        avgScore: 0,
        lowScoreCount: 0,
        columnRoles: [],
      },
    };
  }

  const roles = assignColumnRoles(grid);
  const meta = extractMeta(grid, warnings);

  // 跳过标题/表头行：从第一个「能解析出对阵」的行开始
  const tableCol = pickColumn(roles, 'left', 'table');
  const leftNo = pickColumn(roles, 'left', 'no');
  const leftName = pickColumn(roles, 'left', 'name');
  const leftScore = pickColumn(roles, 'left', 'score');
  const rightNo = pickColumn(roles, 'right', 'no');
  const rightName = pickColumn(roles, 'right', 'name');
  const rightScore = pickColumn(roles, 'right', 'score');

  if (leftName === null && rightName === null) {
    warnings.push(
      '未识别到姓名列（列角色：' + roles.map((r) => `${r.col}:${r.role}/${r.side}`).join(', ') + '）'
    );
  }

  const matches: Match[] = [];
  const pdfScores: Record<string, number> = {};

  for (let r = 0; r < grid.rowCount; r++) {
    const ln = leftName !== null ? cellText(grid, r, leftName).trim() : '';
    const rn = rightName !== null ? cellText(grid, r, rightName).trim() : '';
    if (!ln && !rn) continue;

    const lNo = leftNo !== null ? toInt(cellText(grid, r, leftNo)) : null;
    const rNo = rightNo !== null ? toInt(cellText(grid, r, rightNo)) : null;
    const lScore = leftScore !== null ? toInt(cellText(grid, r, leftScore)) : null;
    const rScore = rightScore !== null ? toInt(cellText(grid, r, rightScore)) : null;

    // 表头行：姓名列内容不像姓名，且没有编号/分数 → 跳过
    if (lNo === null && rNo === null && lScore === null && rScore === null) {
      if (/台|号|姓名|单位|成绩|上轮|分|黑|白/.test(ln + rn)) continue;
    }

    const tableNo = tableCol !== null ? toInt(cellText(grid, r, tableCol)) : null;

    matches.push({
      bout: defaultRound,
      table: tableNo ?? matches.length + 1,
      p1Id: lNo ?? 0,
      p1Name: ln,
      p1Score: lScore ?? 0,
      p2Id: rNo ?? 0,
      p2Name: rn,
      p2Score: rScore ?? 0,
    });

    if (ln && lScore !== null) pdfScores[ln] = lScore;
    if (rn && rScore !== null) pdfScores[rn] = rScore;
  }

  if (matches.length === 0) {
    warnings.push('未能从表格中解析出任何对阵');
  }

  // 结构可信度校验：避免因散乱文本静默产出看似正常的伪对阵。
  // 真实对阵表至少应满足：两侧都有姓名列、行数 >= 3、能取到上轮分。
  if (leftName === null || rightName === null) {
    warnings.push(
      '未识别到完整的双方姓名列（' +
        `左=${leftName ?? '无'} 右=${rightName ?? '无'}），解析结果不可信`
    );
  }
  if (matches.length > 0 && matches.length < 3) {
    warnings.push(`仅解析出 ${matches.length} 场对阵，图片可能不是对阵表或排版过于特殊`);
  }
  if (matches.length > 0 && leftScore === null && rightScore === null) {
    warnings.push('未识别到上轮分列，胜负需人工确认');
  }

  const scores = items.map((i) => i.score);
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const lowScoreCount = scores.filter((s) => s < 0.85).length;

  return {
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.groupName ? { groupName: meta.groupName } : {}),
    ...(meta.roundLabel ? { roundLabel: meta.roundLabel } : {}),
    matches,
    pdfScores,
    warnings,
    stats: {
      rowCount: grid.rowCount,
      columnCount: grid.columnCount,
      itemCount: items.length,
      avgScore: Number(avgScore.toFixed(3)),
      lowScoreCount,
      columnRoles: roles,
    },
  };
}
