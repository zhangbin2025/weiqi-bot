/**
 * 跨轮棋手编号归一（赛事详情页展示前调用）
 * @module services/event/PlayerIds
 *
 * 分轮导入（PDF / 图片）时，每份草稿各自按姓名出现顺序临时编号，
 * 不同轮次里「不同姓名」可能拿到同一个临时编号。排名按 id 建选手，
 * 编号撞车会把两个不同的人合并成一行（表现为积分虚高、累进分异常、
 * 逆减为空）。2026-11-15 用户复测第 2 轮后「一人 4 分」即此因。
 *
 * 契约：
 * - 同名 → 同一 id（修轮空 / 分轮导入下同人不同编号）
 * - 不同名 → 不同 id（避免撞号合并）
 * - 空姓名（轮空）→ 不分配编号、不产生棋手
 * - 尽量沿用首次出现的非零编号；只有该编号已被别的姓名占用时才另分配
 *
 * 纯数据改写：不写库、不改分数、不引入阈值 / 计时 / 打分。
 * 原实现位于 EventDetailPage.fixPlayerIds，此处搬出并修掉撞号，供单测覆盖。
 */

import type { Match } from './types';

/** 最小结构：PdfRound 或任意含 matches 的轮次都可传入 */
export interface IdRound {
  matches: Match[];
}

/**
 * 就地统一所有 match 的棋手编号。
 * 对编号本来就全局唯一的正常数据，行为与原 fixPlayerIds 完全一致（沿用原 id）。
 */
export function normalizePlayerIds(rounds: readonly IdRound[]): void {
  const nameToId = new Map<string, number>();
  const usedIds = new Set<number>();
  let nextFakeId = -1;

  const allocate = (preferred: number): number => {
    if (preferred !== 0 && !usedIds.has(preferred)) {
      usedIds.add(preferred);
      return preferred;
    }
    // 撞号或原本无编号：从未被占用的负数里取，绝不与任何已分配编号相同
    while (usedIds.has(nextFakeId)) nextFakeId -= 1;
    const id = nextFakeId;
    nextFakeId -= 1;
    usedIds.add(id);
    return id;
  };

  // 按轮次 / 台号出现顺序分配；同名沿用首次结果
  for (const round of rounds) {
    for (const m of round.matches) {
      for (const [name, id] of [[m.p1Name, m.p1Id], [m.p2Name, m.p2Id]] as const) {
        if (!name || nameToId.has(name)) continue;
        nameToId.set(name, allocate(id));
      }
    }
  }

  // 写回；空姓名（轮空）保持原样，不产生棋手
  for (const round of rounds) {
    for (const m of round.matches) {
      if (m.p1Name) m.p1Id = nameToId.get(m.p1Name) ?? 0;
      if (m.p2Name) m.p2Id = nameToId.get(m.p2Name) ?? 0;
    }
  }
}
