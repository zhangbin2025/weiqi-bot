/**
 * 赛事草稿校验（图片通道）
 * @description 把模型从图片读出的**编排对阵表**校验成可写库的规范草稿。
 *
 * 语义（与 PDF 导入通道一致，见 services/event/WinLoss.ts）：
 * - 编排表上的「得分」是选手截至本轮的**累计积分（大分）**，不是本轮胜负。
 *   第 1 轮赛前通常全是 0；第 2 轮的累计分里才包含第 1 轮结果。
 * - 草稿里存累计分，由 buildPdfScores 收成 pdfScores 快照；Match.p1Score/p2Score
 *   先置 0，胜负在 commit 里用 recalcWinLoss 按「下一轮 − 本轮」差分回算。
 * - 本文件只做结构校验 + 规范化，不写库、不回算、不引入任何阈值。
 */

import type { Match } from './types';
import { buildPdfScores, type ScorePair } from './WinLoss';

/** 单场草稿输入（table 可省略；p1Id/p2Id 一律由宿主分配，模型不得提供） */
export interface EventDraftMatch {
  table?: number;
  p1Name: string;
  /** 黑方截至本轮的累计积分（大分），非负数字；不是胜负分 */
  p1Score: number;
  p2Name: string;
  /** 白方截至本轮的累计积分（大分），非负数字；轮空填 0 */
  p2Score: number;
}

/** 整份草稿输入形态（groupName 可省略→默认组） */
export interface EventDraftInput {
  title: string;
  groupName?: string;
  round: number;
  matches: EventDraftMatch[];
}

/** 校验通过后的规范草稿：可直接交给 importRound */
export interface EventDraft {
  title: string;
  groupName: string;
  round: number;
  matches: Match[];
  /** 姓名 → 截至本轮的累计积分快照，供下一轮导入时回算本轮胜负 */
  pdfScores: Record<string, number>;
}

const DEFAULT_GROUP_NAME = '默认组';

interface NormalizedMatch {
  table: number;
  p1Name: string;
  p1Score: number;
  p2Name: string;
  p2Score: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 累计积分必须是非负有限数（0 合法；允许小数以兼容表上可能出现的 0.5 等显示） */
function isCumulativeScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function validateEventDraft(
  raw: unknown,
): { ok: true; draft: EventDraft } | { ok: false; errors: string[] } {
  if (!isRecord(raw)) {
    return { ok: false, errors: ['草稿必须是一个对象'] };
  }

  const errors: string[] = [];

  const titleRaw = raw['title'];
  if (typeof titleRaw !== 'string' || titleRaw.trim() === '') {
    errors.push('比赛名称(title)必须是非空字符串');
  }

  const groupRaw = raw['groupName'];
  if (groupRaw !== undefined && typeof groupRaw !== 'string') {
    errors.push('分组名(groupName)必须是字符串');
  }

  const roundRaw = raw['round'];
  if (typeof roundRaw !== 'number' || !Number.isInteger(roundRaw) || roundRaw <= 0) {
    errors.push('轮次(round)必须是正整数');
  }

  const matchesRaw = raw['matches'];
  if (!Array.isArray(matchesRaw) || matchesRaw.length === 0) {
    errors.push('对阵列表(matches)必须是非空数组');
  }

  const normalized: NormalizedMatch[] = [];
  if (Array.isArray(matchesRaw)) {
    matchesRaw.forEach((item: unknown, index: number) => {
      const label = `第${index + 1}场`;
      if (!isRecord(item)) {
        errors.push(`${label}必须是一个对象`);
        return;
      }

      const p1Name = item['p1Name'];
      const p2Name = item['p2Name'];
      const p1Score = item['p1Score'];
      const p2Score = item['p2Score'];
      const table = item['table'];

      if (typeof p1Name !== 'string' || p1Name.trim() === '') {
        errors.push(`${label}黑方姓名(p1Name)不能为空`);
      }
      if (typeof p2Name !== 'string') {
        errors.push(`${label}白方姓名(p2Name)必须是字符串（轮空请填空串）`);
      }
      if (!isCumulativeScore(p1Score)) {
        errors.push(`${label}黑方累计积分(p1Score)必须是非负数字`);
      }
      if (!isCumulativeScore(p2Score)) {
        errors.push(`${label}白方累计积分(p2Score)必须是非负数字`);
      }

      // table 缺省按数组下标 +1；提供了但非法时同样回落缺省值（契约未要求校验 table）
      let resolvedTable = index + 1;
      if (typeof table === 'number' && Number.isInteger(table) && table > 0) {
        resolvedTable = table;
      }

      if (
        typeof p1Name === 'string' && p1Name.trim() !== '' &&
        typeof p2Name === 'string' &&
        isCumulativeScore(p1Score) && isCumulativeScore(p2Score)
      ) {
        normalized.push({
          table: resolvedTable,
          p1Name,
          p1Score,
          p2Name,
          p2Score,
        });
      }
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // 以下收窄仅用于满足 strict：errors 为空时这些字段必然已通过上面的校验
  if (typeof titleRaw !== 'string' || typeof roundRaw !== 'number') {
    return { ok: false, errors: ['草稿缺少合法的标题或轮次'] };
  }

  const title = titleRaw;
  const round = roundRaw;
  const groupName =
    typeof groupRaw === 'string' && groupRaw.trim() !== '' ? groupRaw : DEFAULT_GROUP_NAME;

  // 按姓名稳定编号：先出现的给正数 id（从 1 起），同名跨场一致；轮空/缺失用 0
  const nameToId = new Map<string, number>();
  let nextId = 1;
  const assignId = (name: string): number => {
    if (name.trim() === '') return 0;
    const existing = nameToId.get(name);
    if (existing !== undefined) return existing;
    const id = nextId;
    nextId += 1;
    nameToId.set(name, id);
    return id;
  };

  // 胜负分先置 0：本轮结果要等下一轮累计分导入后由 recalcWinLoss 差分回算
  const matches: Match[] = normalized.map((m) => ({
    bout: round,
    table: m.table,
    p1Id: assignId(m.p1Name),
    p1Name: m.p1Name,
    p1Score: 0,
    p2Id: assignId(m.p2Name),
    p2Name: m.p2Name,
    p2Score: 0,
  }));

  const pairs: ScorePair[] = normalized.map((m) => ({
    blackName: m.p1Name,
    blackScore: m.p1Score,
    whiteName: m.p2Name,
    whiteScore: m.p2Score,
  }));

  return {
    ok: true,
    draft: { title, groupName, round, matches, pdfScores: buildPdfScores(pairs) },
  };
}
