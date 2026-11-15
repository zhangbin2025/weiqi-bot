/**
 * 赛事草稿校验
 * @description 把模型从图片/PDF 读出的结构化对阵信息校验成可写库的规范草稿。
 * 只做结构与枚举校验，不复刻 PDF 累计积分，不写库。
 */

import type { Match } from './types';

/** 单场草稿输入（table 可省略；p1Id/p2Id 一律由宿主分配，模型不得提供） */
export interface EventDraftMatch {
  table?: number;
  p1Name: string;
  p1Score: number;
  p2Name: string;
  p2Score: number;
}

/** 整份草稿输入形态（groupName 可省略→默认组） */
export interface EventDraftInput {
  title: string;
  groupName?: string;
  round: number;
  matches: EventDraftMatch[];
}

/** 校验通过后的规范草稿：matches 已补齐 bout/table/id，可直接交给 importRound */
export interface EventDraft {
  title: string;
  groupName: string;
  round: number;
  matches: Match[];
  pdfScores: Record<string, number>;
}

const DEFAULT_GROUP_NAME = '默认组';
const ALLOWED_SCORES: readonly number[] = [2, 0, 1];

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

function isScore(value: unknown): value is number {
  return typeof value === 'number' && ALLOWED_SCORES.includes(value);
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
      if (!isScore(p1Score)) {
        errors.push(`${label}黑方得分(p1Score)只允许 2/0/1`);
      }
      if (!isScore(p2Score)) {
        errors.push(`${label}白方得分(p2Score)只允许 2/0/1`);
      }

      // 比分组合：只接受 2/0、0/2、1/1；双胜/双负/半和都拒绝
      if (isScore(p1Score) && isScore(p2Score)) {
        if (p1Score === 2 && p2Score === 2) {
          errors.push(`${label}双方不能同为胜(2/2)`);
        } else if (p1Score === 0 && p2Score === 0) {
          errors.push(`${label}双方不能同为负(0/0)`);
        } else if (
          (p1Score === 1 || p2Score === 1) &&
          !(p1Score === 1 && p2Score === 1)
        ) {
          errors.push(`${label}和棋必须双方均为 1(1/1)`);
        }
      }

      // table 缺省按数组下标 +1；提供了但非法时同样回落缺省值（契约未要求校验 table）
      let resolvedTable = index + 1;
      if (typeof table === 'number' && Number.isInteger(table) && table > 0) {
        resolvedTable = table;
      }

      if (
        typeof p1Name === 'string' && p1Name.trim() !== '' &&
        typeof p2Name === 'string' &&
        isScore(p1Score) && isScore(p2Score)
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

  const matches: Match[] = normalized.map((m) => ({
    bout: round,
    table: m.table,
    p1Id: assignId(m.p1Name),
    p1Name: m.p1Name,
    p1Score: m.p1Score,
    p2Id: assignId(m.p2Name),
    p2Name: m.p2Name,
    p2Score: m.p2Score,
  }));

  // 图片直接读胜负，不复刻 PDF 累计积分回算
  return {
    ok: true,
    draft: { title, groupName, round, matches, pdfScores: {} },
  };
}
