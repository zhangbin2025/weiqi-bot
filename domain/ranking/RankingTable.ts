/**
 * 排名表结构校验与单元格格式化
 * @module domain/ranking/RankingTable
 *
 * 内置实现与插件实现共用同一份校验：
 * - 列名只允许汉字（不允许任何标点/字母/HTML 字符）
 * - cells（自定义数据列）只允许有限数值或「元素全为有限数值的数组」
 * - name / rank / id 是宿主保留的只读结构列，不进 cells、不受数值约束
 * - id / name 必须与原始对阵里的选手一致，防止插件伪造或换人
 *
 * 这几条约束让渲染层不需要对插件产出做 HTML 转义：数值与汉字列名
 * 本身不可能构成标签。姓名仍由宿主用原始对阵里的值转义后渲染。
 */

import type {
  MatchData, RankingOutput, RankingTable, RankingInput, RankingCellValue,
} from './types';

const HANZI_LABEL = /^[\u4e00-\u9fa5]{1,12}$/;
const KEY = /^[A-Za-z][A-Za-z0-9_]*$/;

export interface RankingTableCheck {
  ok: boolean;
  missingFields: string[];
  hint?: string;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** cells 合法值：有限数值，或元素全部为有限数值的数组（可为空数组） */
export function isRankingCellValue(v: unknown): v is RankingCellValue {
  if (isFiniteNumber(v)) return true;
  if (Array.isArray(v)) return v.every(isFiniteNumber);
  return false;
}

/**
 * 只描述值的「类型/形状」，不回带真实数据值（沿用 FeedbackPack 的脱敏原则）。
 * 用于把契约失败定位到具体行/列，避免模型只拿到「某一行不合规」而反复盲改。
 */
function describeCellValue(v: unknown): string {
  if (v === undefined) return '缺失（undefined）';
  if (v === null) return 'null';
  if (isFiniteNumber(v)) return '有限数值';
  if (typeof v === 'string') return `字符串（长度 ${v.length}）`;
  if (Array.isArray(v)) {
    const bad = v.findIndex((x) => !isFiniteNumber(x));
    return bad < 0
      ? `数值数组（长度 ${v.length}）`
      : `数组（长度 ${v.length}，第 ${bad + 1} 个元素是 ${typeof v[bad]}）`;
  }
  return typeof v;
}

/**
 * 把 cells 值渲染成纯文本：单数值直接输出，数值数组用 '-' 连接
 * （延续项目里逐轮逆减既有的 3-12 展示格式，不是新造的分隔符）。
 * 值一定是数值/数值数组，不含字符串，故无需 HTML 转义。
 */
export function formatRankingCell(value: RankingCellValue | undefined): string {
  if (value === undefined) return '0';
  if (Array.isArray(value)) return value.map((n) => String(n)).join('-');
  return String(value);
}

/** 校验插件/内置产出的 RankingOutput。约束即文档，改这里等于改契约。 */
export function validateRankingOutput(
  output: unknown,
  input: RankingInput,
): RankingTableCheck {
  const missing: string[] = [];
  // 诊断字段始终非空：没有具体字段名的结构性失败也要让 ContractCheck
  // 能回喂一段完整契约说明（列名汉字 / cells 数值或数值数组）。
  const hint = (text: string): RankingTableCheck => {
    const fields = missing.length > 0 ? missing : ['ranking.output'];
    return { ok: false, missingFields: fields, hint: text };
  };

  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return hint('rank 必须返回 { columns, rows } 对象');
  }
  const o = output as Record<string, unknown>;

  if (!Array.isArray(o['columns'])) {
    missing.push('columns');
    return hint('缺少 columns 数组：每列形如 { key:"score", label:"积分" }');
  }
  if (!Array.isArray(o['rows'])) {
    missing.push('rows');
    return hint('缺少 rows 数组：每行形如 { id, name, rank, cells:{...} }');
  }

  const columns = o['columns'] as unknown[];
  const keys: string[] = [];
  for (const col of columns) {
    if (!col || typeof col !== 'object' || Array.isArray(col)) {
      missing.push('columns[]');
      return hint('columns 每一项都必须是对象');
    }
    const c = col as Record<string, unknown>;
    if (typeof c['key'] !== 'string' || !KEY.test(c['key'])) {
      missing.push('columns[].key');
      return hint('列的 key 只能用英文字母开头的标识符，例如 "score"');
    }
    if (c['key'] === 'rank' || c['key'] === 'name') {
      return hint('"rank" 与 "name" 是宿主保留列，不能出现在 columns 里');
    }
    if (typeof c['label'] !== 'string' || !HANZI_LABEL.test(c['label'])) {
      missing.push('columns[].label(汉字)');
      return hint('列名只能是 1~12 个汉字，不允许字母、数字、标点或 HTML');
    }
    if (keys.includes(c['key'])) return hint(`列 key 重复：${c['key']}`);
    keys.push(c['key']);
  }
  if (keys.length === 0) return hint('columns 至少要有一列');

  const rows = o['rows'] as unknown[];
  const matches = input.matches;
  const byId = new Map<number, string>();
  for (const m of matches) {
    if (m.p1Id && m.p1Name) byId.set(m.p1Id, m.p1Name);
    if (m.p2Id && m.p2Name) byId.set(m.p2Id, m.p2Name);
  }

  const seen = new Set<number>();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      missing.push('rows[]');
      return hint('rows 每一项都必须是对象');
    }
    const r = row as Record<string, unknown>;
    if (!isFiniteNumber(r['id'])) {
      missing.push('rows[].id(number)');
      return hint('每行的 id 必须是对阵表里的数值 id');
    }
    const id = r['id'] as number;
    if (!byId.has(id)) return hint(`id ${id} 不在原始对阵里，插件不能新增选手`);
    if (seen.has(id)) return hint(`id ${id} 重复`);
    seen.add(id);
    if (r['name'] !== byId.get(id)) {
      missing.push('rows[].name');
      return hint('name 必须与原始对阵里的姓名完全一致，不能改写');
    }
    if (!isFiniteNumber(r['rank'])) {
      missing.push('rows[].rank(number)');
      return hint('rank 必须是有限数值');
    }
    if (!r['cells'] || typeof r['cells'] !== 'object' || Array.isArray(r['cells'])) {
      missing.push('rows[].cells');
      return hint('每行都要有 cells 对象，存放各列数值或数值数组');
    }
    const cells = r['cells'] as Record<string, unknown>;
    for (const k of keys) {
      if (!isRankingCellValue(cells[k])) {
        missing.push(`rows[].cells.${k}(number|number[])`);
        // 定位到具体行/列：columns 的每个 key 都必须在每一行 cells 里给出合法值。
        // 只报类型与形状，不回带真实分数/姓名（诊断信息保持确定性且不泄漏数据）。
        const declared = keys.join('、');
        const present = Object.keys(cells).join('、') || '（空）';
        return hint(
          `列 ${k} 在第 ${rowIndex + 1} 行（id=${id}）的 cells.${k} 实际是「${describeCellValue(cells[k])}」，`
          + `要求为有限数值或元素全为有限数值的数组；cells 不支持字符串、HTML、null 或对象。`
          + ` columns 声明了 ${keys.length} 个 key（${declared}），`
          + `该行 cells 实际有 ${Object.keys(cells).length} 个 key（${present}）；`
          + `columns 的每个 key 都必须在每一行的 cells 里都有合法值，请检查是不是只给部分行填了这一列。`,
        );
      }
    }
  }

  for (const id of byId.keys()) {
    if (!seen.has(id)) return hint(`选手 ${id} 缺失，rows 必须覆盖全部参赛者`);
  }
  if (rows.length === 0 && byId.size > 0) return hint('rows 为空，请检查入口是否被调用');

  return { ok: true, missingFields: [] };
}

/** 从原始对阵派生轮次元信息（与排名实现无关，内置/插件都走这里） */
export function deriveRounds(matches: MatchData[]): { totalRounds: number; completedRounds: number } {
  if (matches.length === 0) return { totalRounds: 0, completedRounds: 0 };
  const totalRounds = Math.max(...matches.map((m) => m.bout));
  let completedRounds = 0;
  for (let bout = 1; bout <= totalRounds; bout++) {
    if (matches.some((m) => m.bout === bout && (m.p1Score !== 0 || m.p2Score !== 0))) completedRounds++;
  }
  return { totalRounds, completedRounds };
}

/** 把校验通过的 RankingOutput 组装成 RankingTable（rows 已按实现给的顺序，不再重排） */
export function toRankingTable(output: RankingOutput, matches: MatchData[]): RankingTable {
  return { ...output, ...deriveRounds(matches) };
}
