/**
 * 累计积分 → 胜负回算（PDF 导入通道既有逻辑的共享副本）
 * @module services/event/WinLoss
 *
 * 语义来源：PdfEventTypes.ts 的 PdfRound.pdfScores 注释 +
 * presentation/adapters/web/pages/event/EventPage.ts 的私有方法
 * buildPdfScores / recalcWinLoss / deltaToWinLoss / findPlayerId（逐字等价搬出）。
 *
 * 编排对阵表上的「得分」是选手**截至本轮的累计积分（大分）**，不是本轮胜负：
 * - 第 1 轮赛前双方通常都是 0；
 * - 第 2 轮表上的累计分里已包含第 1 轮结果；
 * - 每轮把「姓名 → 累计分」存成 pdfScores 快照，导入下一轮后用
 *   「下一轮累计分 − 本轮累计分」差分反推**上一轮**胜负：+2→胜(2)、+1→和(1)、+0→负(0)；
 * - 最后一轮还没有下一轮可差分，胜负一律先置 0。
 *
 * 这里只做纯数据推导：不碰 IndexedDB / sessionStorage，不引入任何阈值、计时或打分。
 * WIN/DRAW/LOSS 沿用 EventPage 原有的具名常量值（2/1/0），来源是围棋赛事计分口径。
 */

import type { Match } from './types';

/** 本轮胜负计分口径：胜 2 / 和 1 / 负 0 */
const WIN = 2;
const DRAW = 1;
const LOSS = 0;

/** 一轮的累计分快照 + 对阵（PdfRound 的最小结构，PdfRound 可直接赋值） */
export interface ScoreRound {
  round: number;
  matches: Match[];
  pdfScores: Record<string, number>;
}

/** 累计分快照来源：PDF 解析产物与图片模型草稿的最小公共形态 */
export interface ScorePair {
  blackName: string;
  blackScore: number;
  whiteName: string;
  whiteScore: number;
}

/** 把每场表上的累计分收成「姓名 → 累计分」快照；轮空（空名）不记 */
export function buildPdfScores(pairs: readonly ScorePair[]): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const m of pairs) {
    if (m.blackName) scores[m.blackName] = m.blackScore;
    if (m.whiteName) scores[m.whiteName] = m.whiteScore;
  }
  return scores;
}

function deltaToWinLoss(delta: number): number {
  if (delta >= WIN) return WIN;
  if (delta === DRAW) return DRAW;
  return LOSS;
}

function findPlayerId(rounds: readonly ScoreRound[], name: string): number {
  for (const r of rounds) {
    for (const m of r.matches) {
      if (m.p1Name === name && m.p1Id) return m.p1Id;
      if (m.p2Name === name && m.p2Id) return m.p2Id;
    }
  }
  return -1;
}

/**
 * 按累计分差分回算每一轮的胜负（就地修改 matches 的 p1Score/p2Score）。
 * 按 round 升序，逐轮用下一轮快照减本轮快照；本轮没出现在对阵里、但累计分上涨的
 * 选手补一条轮空胜；最后一轮胜负置 0。与 EventPage 原私有方法逐字等价。
 */
export function recalcWinLoss(group: { rounds: ScoreRound[] }): void {
  const rounds = group.rounds.sort((a, b) => a.round - b.round);
  if (rounds.length === 0) return;

  const allPlayerNames = new Set<string>();
  for (const r of rounds) {
    for (const m of r.matches) {
      if (m.p1Name) allPlayerNames.add(m.p1Name);
      if (m.p2Name) allPlayerNames.add(m.p2Name);
    }
    for (const name of Object.keys(r.pdfScores)) {
      allPlayerNames.add(name);
    }
  }

  for (let i = 0; i < rounds.length - 1; i++) {
    const curRound = rounds[i]!;
    const nextPdfScores = rounds[i + 1]!.pdfScores;

    for (const m of curRound.matches) {
      const nextP1 = nextPdfScores[m.p1Name] ?? 0;
      const nextP2 = nextPdfScores[m.p2Name] ?? 0;
      const curP1 = curRound.pdfScores[m.p1Name] ?? 0;
      const curP2 = curRound.pdfScores[m.p2Name] ?? 0;
      m.p1Score = deltaToWinLoss(nextP1 - curP1);
      m.p2Score = deltaToWinLoss(nextP2 - curP2);
    }

    const matchPlayerNames = new Set<string>();
    for (const m of curRound.matches) {
      if (m.p1Name) matchPlayerNames.add(m.p1Name);
      if (m.p2Name) matchPlayerNames.add(m.p2Name);
    }
    for (const name of allPlayerNames) {
      if (matchPlayerNames.has(name)) continue;
      const curScore = curRound.pdfScores[name] ?? 0;
      const nextScore = nextPdfScores[name] ?? 0;
      const delta = nextScore - curScore;
      if (delta > 0) {
        const existingId = findPlayerId(rounds, name);
        curRound.matches.push({
          bout: curRound.round,
          table: curRound.matches.length + 1,
          p1Id: existingId,
          p1Name: name,
          p1Score: deltaToWinLoss(delta),
          p2Id: 0,
          p2Name: '',
          p2Score: 0,
        });
      }
    }
  }

  const lastRound = rounds[rounds.length - 1]!;
  for (const m of lastRound.matches) {
    m.p1Score = 0;
    m.p2Score = 0;
  }
}
