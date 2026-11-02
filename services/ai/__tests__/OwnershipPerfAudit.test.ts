/**
 * @fileoverview 性能审计：确认「正常功能路径」不请求 includeOwnership
 *
 * @description 用户关心：形势功能是否把额外的 ownership NN 计算带进了
 * 正常对局/分析路径。此测试用假引擎记录每次 query 的 includeOwnership 字段，
 * 验证三件事：
 *   1) 默认状态（从未点形势）：genmove / analyze 都不带 true
 *   2) 点一次形势（hm/mm 单发模式）：只有那一次带 true
 *   3) 形势结束后：后续 genmove / analyze 恢复不带（无残留）
 */

import { describe, it, expect } from 'vitest';
import { AIController } from '../AIController';

/** 记录每次请求是否带 includeOwnership */
interface Seen {
  kind: string;
  includeOwnership: unknown;
}

/** 假引擎：只记录查询，不做真实计算 */
function createSpyEngine(seen: Seen[]) {
  return {
    async init() {
      /* 不需要真实加载模型 */
    },
    async analyze(query: Record<string, unknown>) {
      seen.push({ kind: 'analyze', includeOwnership: query.includeOwnership });
      return {
        moves: [{ order: 0, x: 4, y: 4, winRate: 0.5, scoreLead: 0, visits: 1, pv: [] }],
        rootWinRate: 0.5,
        rootScoreLead: 0,
      };
    },
    async genmove(query: Record<string, unknown>) {
      seen.push({ kind: 'genmove', includeOwnership: query.includeOwnership });
      return { x: 4, y: 4, winRate: 0.5, scoreLead: 0, visits: 1, pv: [] };
    },
    isReady: () => true,
  };
}

/** 造一个已初始化的控制器 */
async function createController(seen: Seen[]): Promise<AIController> {
  const ctrl = new AIController(createSpyEngine(seen) as never);
  await ctrl.init('test-model');
  return ctrl;
}

describe('ownership 性能审计', () => {
  const board = { size: 9, stones: new Int8Array(81) } as never;
  const history: never[] = [];

  it('默认状态：genmove / analyze 都不请求 ownership', async () => {
    const seen: Seen[] = [];
    const ctrl = await createController(seen);

    await ctrl.genmove(board, null, 'black', history, 7.5, 100);
    await ctrl.analyze(board, null, 'black', history, 7.5, 100);

    expect(seen).toHaveLength(2);
    for (const s of seen) {
      expect(s.includeOwnership).not.toBe(true);
    }
  });

  it('点一次形势：只有那一次请求 ownership', async () => {
    const seen: Seen[] = [];
    const ctrl = await createController(seen);

    ctrl.setOwnershipRequested(true);
    await ctrl.analyze(board, null, 'black', history, 7.5, 20);
    ctrl.setOwnershipRequested(false);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.includeOwnership).toBe(true);
  });

  it('形势结束后无残留：后续请求恢复不带 ownership', async () => {
    const seen: Seen[] = [];
    const ctrl = await createController(seen);

    // 模拟完整的一次形势
    ctrl.setOwnershipRequested(true);
    await ctrl.analyze(board, null, 'black', history, 7.5, 20);
    ctrl.setOwnershipRequested(false);

    seen.length = 0;
    await ctrl.genmove(board, null, 'black', history, 7.5, 100);
    await ctrl.analyze(board, null, 'black', history, 7.5, 100);

    expect(seen).toHaveLength(2);
    for (const s of seen) {
      expect(s.includeOwnership).not.toBe(true);
    }
  });

  it('isOwnershipRequested 默认 false', async () => {
    const ctrl = await createController([]);
    expect(ctrl.isOwnershipRequested()).toBe(false);
  });
});
