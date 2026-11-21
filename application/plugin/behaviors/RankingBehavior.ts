/**
 * ranking 扩展点的行为配方（业务模块，允许 import @domain/ranking/*）
 * @module application/plugin/behaviors/RankingBehavior
 *
 * 把原先散落在框架文件里的排名专属逻辑全部收敛到这一份声明式配方：
 * 代表性对阵样例、输出契约校验（沿用 RankingTable.validateRankingOutput 原口径）、
 * 自定义 matches 解析、表格观察文本、以及全部默认 / 标签 / 契约说明文案。
 * 框架层不认识 ranking，只按 pointId 查表调用本对象；未来新增扩展点照此办理。
 *
 * 不变量：rank(input)，input={matches:[...]}，返回 { columns, rows }；
 * columns.key 英文、label 1–12 汉字；rows[].{id,name,rank,cells}，cells 只能是
 * 有限数值或数值数组；轮空 / 未完赛 / 真实选手覆盖规则全部沿用既有
 * validateRankingOutput，不另立解释、不引入新阈值或经验常数。
 */

import type { ContractCheck } from '@domain/plugin/types';
import { RANKING_POINT_ID } from '@domain/plugin/types';
import type {
  ExtensionPointBehavior, ExtensionPointTrialContext, TrialCaseBuildResult,
} from '@domain/plugin/ExtensionPointBehavior';
import { SAMPLE_RANKING_INPUT } from '@domain/ranking/sampleInput';
import { validateRankingOutput } from '@domain/ranking/RankingTable';
import type { RankingInput, RankingOutput, MatchData } from '@domain/ranking/types';

/** 沙箱契约说明：逐字沿用 11-13 已确认的口径，不另立解释、不改数值 */
export const RANKING_CONTRACT_LINES = [
  '- 入口固定为 rank(input)，input 只有 { matches: [...] }，matches 是最原始的对阵表。',
  '- 每场含 bout/table/p1Id/p1Name/p1Score/p2Id/p2Name/p2Score；胜=2、负=0、和=1。',
  '- 积分、对手分、累进分、逆减、胜局等一切中间量都要自己从 matches 算，宿主不代算、不预置字段。',
  '- 必须返回 { columns, rows }：columns 是 [{key,label}]，key 为英文标识符，label 只能是 1~12 个汉字；',
  '  rows 是 [{id,name,rank,cells}]，id/name 必须与对阵表里的选手完全一致，rank 为数值名次。',
  '- cells 里每列的值只能是「有限数值」或「元素全为有限数值的数组」（如逐轮逆减 [3,12] 显示 3-12），',
  '  不支持字符串、HTML、null、对象或其它格式；rank/name/id 是宿主保留的只读结构列，不在 cells 里、不能出现在 columns 里。',
  '  columns 声明的每一个 key，都必须在每一行的 cells 里都有对应的合法值；',
  '  只给部分行填某一列、或漏填，都会导致整份输出不通过校验。建议先构造齐所有行再统一填 cells。',
  '- 显示哪些列、叫什么、顺序、值全部由 columns + cells 决定，插件可自由加列删列改名。',
  '- 轮空：p1Id/p2Id 为 0 或姓名为空的一侧不是选手、不进 rows，但另一侧比分照常计入；',
  '  双方比分全 0 = 未完赛。rows 必须恰好覆盖对阵表里全部真实选手，不能多不能少。',
].join('\n');

/** 把 {columns, rows} 渲染成人能看懂的表格文本，作为工具观察 */
export function formatRankingTable(output: RankingOutput): string {
  const labels = output.columns.map((c) => c.label);
  const head = ['名次', '姓名', ...labels].join(' | ');
  const lines = output.rows.map((row) => {
    const cells = output.columns.map((c) => {
      const v = row.cells[c.key];
      if (v === undefined) return '-';
      return Array.isArray(v) ? v.join('-') : String(v);
    });
    return [String(row.rank), row.name, ...cells].join(' | ');
  });
  return [head, ...lines].join('\n');
}

/** 自定义 matches 的轻量校验：只查结构，不新造业务口径；不合法明确告知模型 */
export function parseMatches(raw: unknown): { ok: true; input: RankingInput } | { ok: false; reason: string } {
  if (!Array.isArray(raw)) return { ok: false, reason: 'matches 必须是数组' };
  const required = ['bout', 'p1Id', 'p1Name', 'p1Score', 'p2Id', 'p2Name', 'p2Score'] as const;
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i] as Record<string, unknown> | null;
    if (!m || typeof m !== 'object') return { ok: false, reason: `matches[${i}] 不是对象` };
    for (const k of required) {
      if (m[k] === undefined) return { ok: false, reason: `matches[${i}] 缺少 ${k}` };
    }
    if (typeof m['p1Name'] !== 'string' || typeof m['p2Name'] !== 'string'
      || typeof m['p1Id'] !== 'number' || typeof m['p2Id'] !== 'number'
      || typeof m['p1Score'] !== 'number' || typeof m['p2Score'] !== 'number'
      || typeof m['bout'] !== 'number') {
      return { ok: false, reason: `matches[${i}] 字段类型不对（bout/p1Id/p2Id/p1Score/p2Score 应为数值，姓名应为字符串）` };
    }
  }
  return { ok: true, input: { matches: raw as MatchData[] } };
}

export const rankingBehavior: ExtensionPointBehavior = {
  pointId: RANKING_POINT_ID,
  label: '排名插件',
  resultLabel: '排名表',
  revisionResultLabel: '本版排名表',
  contractLines: RANKING_CONTRACT_LINES,
  supportsApplySelection: true,
  pointIdDescription: '"ranking"（排名插件）：入口 rank(input)，input={matches:[...]}，返回 { columns, rows }',
  trialInput: {
    param: 'matches',
    schema: {
      type: 'array',
      description: '自定义对阵表；省略则用行为自带的代表性样例。每项含 bout/p1Id/p1Name/p1Score/p2Id/p2Name/p2Score',
      items: {
        type: 'object',
        properties: {
          bout: { type: 'number' }, table: { type: 'number' },
          p1Id: { type: 'number' }, p1Name: { type: 'string' }, p1Score: { type: 'number' },
          p2Id: { type: 'number' }, p2Name: { type: 'string' }, p2Score: { type: 'number' },
        },
        required: ['bout', 'p1Id', 'p1Name', 'p1Score', 'p2Id', 'p2Name', 'p2Score'],
      },
    },
  },

  buildTrialCases(ctx: ExtensionPointTrialContext): TrialCaseBuildResult {
    let input: RankingInput = SAMPLE_RANKING_INPUT;
    let usedCustomInput = false;
    if (ctx.customInput !== undefined) {
      const parsed = parseMatches(ctx.customInput);
      if (!parsed.ok) return { ok: false, reason: parsed.reason };
      input = parsed.input;
      usedCustomInput = true;
    }
    return {
      ok: true,
      cases: [{ input, label: usedCustomInput ? '自定义对阵表' : '内置代表性样例' }],
      usedCustomInput,
    };
  },

  validateOutput(output: unknown, input: unknown): ContractCheck {
    // input 省略时回落到代表性对阵样例；口径仍是同一份 validateRankingOutput。
    const effective: RankingInput = input === undefined
      ? SAMPLE_RANKING_INPUT
      : input as RankingInput;
    const check = validateRankingOutput(output, effective);
    return {
      entryFound: check.ok,
      outputIsArray: false,
      missingFields: check.missingFields,
      // 原样透传详细定位；A2 重构曾在此丢弃 hint，导致契约失败观察退化成笼统文案。
      ...(check.hint !== undefined ? { hint: check.hint } : {}),
    };
  },

  contractHint(check: ContractCheck): string {
    const detail = check.missingFields.join('、') || '未知原因';
    const general = `排名表不符合契约（${detail}）：必须返回 { columns, rows } 对象，列名为汉字，cells 只能是数值或数值数组`;
    // validateRankingOutput 的 hint 定位到具体行/列（不回带真实分数/姓名），
    // 原样附在通用说明后；不另造解释、不引入新口径。
    return check.hint !== undefined ? `${general}\n具体定位：${check.hint}` : general;
  },

  formatResult(outputs: readonly unknown[]): string {
    const table = outputs[0] as RankingOutput | undefined;
    if (table === undefined) return '';
    return formatRankingTable(table);
  },

  trialScopeLabel(usedCustomInput: boolean): string {
    return usedCustomInput ? '自定义对阵表' : '内置代表性样例';
  },

  // ranking 不带 exposes[]/smoke[] 资源契约：不提供 parseContract / validateContract /
  // artifactContract / matchesExpect，框架据此走「只验输出契约」的通用路径。
};
