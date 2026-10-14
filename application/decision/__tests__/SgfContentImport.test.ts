import { describe, it, expect } from 'vitest';
import { md5 } from 'js-md5';
import { DecisionApp } from '../DecisionApp';
import { DecisionService } from '../../../services/decision/DecisionService';
import {
  DECISION_SOURCE_LABELS,
  DECISION_IMPORT_KEY_PREFIX,
  getDecisionSourceLabel,
  resolveDecisionSourceLabel,
} from '../DecisionApp';

// 第5手 B[nc] 后有 3 个变化分支（最高60%，最低30%），实战选点胜率回退取最低分支30% => 差30%>20% 触发恶手题
const SGF = '(;GM[1]FF[4]CA[UTF-8]SZ[19]PB[黑]PW[白]KM[6.5]RE[B+R]\n;B[pd];W[dd];B[qp];W[dp];B[nc]C[黑50%]\n(;B[qf]C[黑60.0%]W[nc];B[fc])\n(;B[nd]C[黑30.0%]W[po])\n(;B[fq]C[黑55.0%]))';

// 9 路棋盘，坐标均在 a-i 内
const SMALL = '(;GM[1]FF[4]CA[UTF-8]SZ[9]PB[黑]PW[白]KM[5.5]RE[B+R]\n;B[cc];W[gc];B[cg];W[eg];B[gg]C[黑50%]\n(;B[ee]C[黑60.0%]W[gg])\n(;B[dd]C[黑30.0%]W[fg])\n(;B[ff]C[黑55.0%]))';

describe('generateFromSGFContent 端到端', () => {
  it('从 SGF 内容生成恶手题并写入 boardSize', async () => {
    const app = new DecisionApp(undefined, new DecisionService());
    const res = await app.generateFromSGFContent(SGF, { fileName: 't.sgf' });
    expect(res.problems.length).toBeGreaterThan(0);
    for (const p of res.problems) { expect(p.metadata.boardSize).toBe(19); }
  });

  it('9 路棋盘 boardSize 正确传递', async () => {
    const app = new DecisionApp(undefined, new DecisionService());
    const res = await app.generateFromSGFContent(SMALL, { fileName: 's.sgf' });
    expect(res.problems.length).toBeGreaterThan(0);
    for (const p of res.problems) { expect(p.metadata.boardSize).toBe(9); }
  });
});


describe('导入棋谱的来源标签', () => {
  /** 记录 addFavorite 入参的假收藏服务 */
  function fakeFavorite() {
    const calls: Array<{ key: string; data: Record<string, unknown> }> = [];
    return {
      calls,
      addFavorite: async (_c: string, key: string, data: Record<string, unknown>) => {
        calls.push({ key, data });
        return 'fav-1';
      },
    } as any;
  }

  it('导入生成的记录展示为「导入棋谱」，即使 SGF 被识别成野狐视角', async () => {
    const fav = fakeFavorite();
    const app = new DecisionApp(undefined, new DecisionService(), fav);
    // 显式传 source='foxwq'（executeImport 对非 OGS 棋谱就是这么传的）
    const res = await app.generateFromSGFContent(SGF, { fileName: 't.sgf', source: 'foxwq' });

    expect(res.problems.length).toBeGreaterThan(0);
    const saved = fav.calls[0]!;
    // 分析用的 source 仍是 foxwq（胜率视角需要），但展示标签必须是「导入棋谱」
    expect(saved.data['source']).toBe('foxwq');
    expect(saved.data['sourceLabel']).toBe('导入棋谱');
    expect(saved.key.startsWith(DECISION_IMPORT_KEY_PREFIX)).toBe(true);
  });

  it('OGS 棋谱导入同样显示「导入棋谱」，而非 OGS', async () => {
    const fav = fakeFavorite();
    const app = new DecisionApp(undefined, new DecisionService(), fav);
    const res = await app.generateFromSGFContent(SGF, { fileName: 'o.sgf', source: 'ogs' });
    expect(res.problems.length).toBeGreaterThan(0);
    expect(fav.calls[0]!.data['sourceLabel']).toBe('导入棋谱');
  });

  it('线上生成的记录保留真实来源标签', () => {
    expect(getDecisionSourceLabel('foxwq')).toBe('野狐');
    expect(getDecisionSourceLabel('ogs')).toBe('OGS');
    expect(getDecisionSourceLabel('lib')).toBe('内置棋谱');
    expect(getDecisionSourceLabel()).toBe('导入棋谱');
    expect(DECISION_SOURCE_LABELS['import']).toBe('导入棋谱');
  });

  it('老数据（无 sourceLabel）靠收藏键 import_ 前缀兜底为「导入棋谱」', () => {
    // 老数据只存了 source='foxwq'，但收藏键是导入生成的
    expect(
      resolveDecisionSourceLabel({ source: 'foxwq' }, 'import_1700000000000'),
    ).toBe('导入棋谱');
    // 线上生成的老数据（键为 foxwq_2026-10-13）仍显示真实来源
    expect(
      resolveDecisionSourceLabel({ source: 'foxwq' }, 'foxwq_2026-10-13'),
    ).toBe('野狐');
    // 新数据直接取落库的标签
    expect(
      resolveDecisionSourceLabel({ source: 'foxwq', sourceLabel: '导入棋谱' }, 'import_1'),
    ).toBe('导入棋谱');
  });
});


describe('导入棋谱去重', () => {
  /** 记录 addFavorite 入参的假收藏服务 */
  function fakeFavorite() {
    const calls: Array<{ key: string; data: Record<string, unknown> }> = [];
    const byKey = new Map<string, Record<string, unknown>>();
    return {
      calls,
      byKey,
      addFavorite: async (_c: string, key: string, data: Record<string, unknown>) => {
        calls.push({ key, data });
        byKey.set(key, data);
        return 'fav-' + key;
      },
      getFavorite: async (_c: string, key: string) =>
        byKey.has(key) ? { id: 'fav-' + key, key, data: byKey.get(key) } : null,
    } as any;
  }

  it('收藏键由 SGF 内容决定（内容寻址，与时间无关）', async () => {
    const fav = fakeFavorite();
    const app = new DecisionApp(undefined, new DecisionService(), fav);
    const a = await app.generateFromSGFContent(SGF, { fileName: 'a.sgf' });

    // 直接钉住契约：键 = 前缀 + SGF 内容 md5。
    // 用 Date.now() 时这里必然不成立（两次调用甚至可能落在同一毫秒而偶发相等，
    // 所以必须断言具体值，而不是只断言两次相等）。
    expect(a.key).toBe(DECISION_IMPORT_KEY_PREFIX + md5(SGF).toLowerCase());
  });

  it('同一份棋谱重复导入 → 收藏键相同（不会新增历史条目）', async () => {
    const fav = fakeFavorite();
    const app = new DecisionApp(undefined, new DecisionService(), fav);
    const a = await app.generateFromSGFContent(SGF, { fileName: 'a.sgf' });
    const b = await app.generateFromSGFContent(SGF, { fileName: 'b.sgf' });

    // 文件名不同但内容相同，仍视为同一份棋谱
    expect(a.key).toBe(b.key);
    expect(a.key.startsWith(DECISION_IMPORT_KEY_PREFIX)).toBe(true);
  });

  it('不同棋谱 → 收藏键不同', async () => {
    const fav = fakeFavorite();
    const app = new DecisionApp(undefined, new DecisionService(), fav);
    const a = await app.generateFromSGFContent(SGF, { fileName: 'a.sgf' });
    const c = await app.generateFromSGFContent(SMALL, { fileName: 'c.sgf' });
    expect(a.key).not.toBe(c.key);
  });

  it('重复导入命中同一条记录（addFavorite 按 key upsert）', async () => {
    const fav = fakeFavorite();
    const app = new DecisionApp(undefined, new DecisionService(), fav);
    await app.generateFromSGFContent(SGF, { fileName: 'a.sgf' });
    await app.generateFromSGFContent(SGF, { fileName: 'a.sgf' });
    // 两次写入同一个 key → 收藏里只保留一条
    expect(fav.byKey.size).toBe(1);
    expect(fav.calls.length).toBe(2);
    expect(fav.calls[0]!.key).toBe(fav.calls[1]!.key);
  });
});
