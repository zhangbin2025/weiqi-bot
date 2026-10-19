/**
 * 列角色识别
 * @module services/ocr/ColumnRoles
 *
 * 真实赛事表格的列数/顺序/是否含「单位」列都不同，不能硬编码列号。
 * 这里按「整列内容特征投票」判断每列语义，再据此组装对阵数据。
 */

import type { TableGrid } from './types';
import { cellText } from './TableBuilder';

/** 列语义 */
export type ColumnRole =
  | 'table'      // 台号
  | 'no'         // 选手编号
  | 'name'       // 姓名
  | 'team'       // 单位 / 队伍
  | 'score'      // 上轮累计分
  | 'result'     // 成绩符号（: / … / 空），可忽略
  | 'unknown';

/** 分侧：仅用于把对称的两侧列区分开 */
export type Side = 'left' | 'right';

export interface ColumnAssignment {
  /** 列序号 */
  col: number;
  role: ColumnRole;
  /** 属于对阵表的哪一侧（左=黑方/上方，右=白方/下方） */
  side: Side;
  /** 该列判定的置信依据，便于日志排查 */
  evidence: string;
  /** 非空单元格占比（0~1），用于在同一角色的多个候选列里挑真正的那一列 */
  fill?: number;
}

const RE_INT = /^\d{1,4}$/;
const RE_NAME = /^[一-龥·•]{1,6}$/;
const RE_RESULT = /^[:：.…・\-—–*＊xX×\s]*$/;
const RE_TEAM_HINT = /(棋院|俱乐部|队|学校|学院|小学|中学|大学|围棋|围棋道场|培训中心|协会|公司)/;

/**
 * 判定单列角色
 * @param texts 该列所有行的文本（含表头）
 */
function judgeColumn(texts: string[]): { role: ColumnRole; evidence: string } {
  const body = texts.map((t) => t.trim()).filter(Boolean);
  if (body.length === 0) return { role: 'unknown', evidence: '空列' };

  // 表头直接命中优先
  const head = body[0] ?? '';
  if (/台|桌|序号|序/.test(head) && !/号$/.test(head)) {
    return { role: 'table', evidence: `表头「${head}」` };
  }

  const data = body.filter((t) => t !== head);
  const sample = data.length > 0 ? data : body;
  const n = sample.length;

  const intCount = sample.filter((t) => RE_INT.test(t)).length;
  const nameCount = sample.filter((t) => RE_NAME.test(t)).length;
  const resultCount = sample.filter((t) => RE_RESULT.test(t)).length;
  const teamCount = sample.filter((t) => RE_TEAM_HINT.test(t)).length;

  // 成绩列：绝大多数是 : … 或空
  if (resultCount / n > 0.5) return { role: 'result', evidence: `${resultCount}/${n} 为符号` };

  // 单位列：含机构关键词
  if (teamCount / n > 0.3) return { role: 'team', evidence: `${teamCount}/${n} 含机构词` };

  // 纯数字列
  if (intCount / n > 0.7) {
    const nums = sample.filter((t) => RE_INT.test(t)).map((t) => +t);
    const max = Math.max(...nums);
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    // 去重率：编号/台号每行都不同（≈1.0），累计分大量重复（实测 0.16）
    const distinctRatio = new Set(nums).size / nums.length;

    // 累计分列：值域窄且高度重复（同分段的人很多）
    if (distinctRatio < 0.5) {
      return {
        role: 'score',
        evidence: `去重率${distinctRatio.toFixed(2)} 值域${Math.min(...nums)}~${max}`,
      };
    }

    // 台号与编号都是连续小整数，难区分；用「是否单调递增且等于行序」判台号
    const isSequential = nums.every((v, i) => v === i + 1);
    if (isSequential && max === n) return { role: 'table', evidence: `${n} 行连续 1..${max}` };

    // 台号通常是该表最左侧的整数列；其余不重复的整数列视为编号
    return { role: 'no', evidence: `去重率${distinctRatio.toFixed(2)} 最大${max} 均值${avg.toFixed(1)}` };
  }

  // 中文列：姓名 vs 单位
  if (nameCount / n > 0.6) {
    const avgLen = sample.reduce((s, t) => s + t.length, 0) / n;
    // 姓名一般 2~4 字；单位名更长
    if (avgLen <= 4) return { role: 'name', evidence: `${nameCount}/${n} 中文 均长${avgLen.toFixed(1)}` };
    return { role: 'team', evidence: `中文长串 均长${avgLen.toFixed(1)}` };
  }

  return { role: 'unknown', evidence: `混合内容 n=${n}` };
}

/**
 * 为表格的每一列判定角色与左右侧
 *
 * 左右侧判定：以「成绩/分隔列」为界，或按列序中点切分。
 */
export function assignColumnRoles(grid: TableGrid): ColumnAssignment[] {
  const cols = grid.columns.map((c) => c.index);
  const textsByCol = new Map<number, string[]>();
  for (const c of cols) {
    const arr: string[] = [];
    for (let r = 0; r < grid.rowCount; r++) arr.push(cellText(grid, r, c));
    textsByCol.set(c, arr);
  }

  const judged = cols.map((c) => ({ col: c, ...judgeColumn(textsByCol.get(c) ?? []) }));

  // 左右侧判定：优先用「两个姓名列」的相对位置，而不是靠 result 列或列序中点。
  //
  // 实测踩过的坑：result 列被判成 col10（真正的成绩列 col6 内容其实是
  // '成绩上轮'），分隔列找错 → 白方姓名列 col7 被判成 left →
  // pickColumn(roles,'right','name') 返回 null，整张表的白方全部丢失。
  //
  // 对阵表的结构是固定的：黑方团队/姓名/积分 ... 白方积分/姓名/团队，
  // 所以两个 name 列必然一左一右，用它们划界最可靠。
  const nameCols = judged.filter((j) => j.role === 'name').map((j) => j.col);
  let splitIdx = -1;
  if (nameCols.length >= 2) {
    splitIdx = Math.floor((nameCols[0]! + nameCols[nameCols.length - 1]!) / 2);
  }
  if (splitIdx < 0) {
    const ri = judged.findIndex((j) => j.role === 'result');
    splitIdx = ri >= 0 ? judged[ri]!.col : Math.floor(judged.length / 2);
  }

  return judged.map((j) => {
    const texts = textsByCol.get(j.col) ?? [];
    const filled = texts.filter((t) => t.trim()).length;
    return {
      col: j.col,
      role: j.role,
      side: j.col <= splitIdx ? 'left' : 'right',
      // 非空单元格占比：用于在同一角色的多个候选列里挑真正的那一列
      fill: texts.length > 0 ? filled / texts.length : 0,
      evidence: j.evidence,
    };
  });
}

/**
 * 从列角色里挑出目标角色
 *
 * 同一角色可能有多个候选列（实测白方编号：col9 只有 2 个值、col11 才是真编号）。
 * 取「非空单元格占比」最高的那个，而不是取第一个。
 */
export function pickColumn(assignments: ColumnAssignment[], side: Side, role: ColumnRole): number | null {
  const hits = assignments.filter((a) => a.side === side && a.role === role);
  if (hits.length === 0) return null;
  let best = hits[0]!;
  for (const h of hits) {
    if ((h.fill ?? 0) > (best.fill ?? 0)) best = h;
  }
  return best.col;
}
