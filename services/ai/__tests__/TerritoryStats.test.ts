import { describe, it, expect } from 'vitest';
import {
  computeTerritoryStats,
  formatLead,
  territoryVisitsForModel,
  TERRITORY_VISITS_SMALL_MODEL,
  TERRITORY_VISITS_LARGE_MODEL,
} from '../TerritoryStats';

/** 构造 ownership：blackPts 个全黑格，whitePts 个全白格，其余 0 */
function mkOwnership(size: number, blackPts: number, whitePts: number): Float32Array {
  const arr = new Float32Array(size * size);
  let idx = 0;
  for (let i = 0; i < blackPts; i++) arr[idx++] = 1;
  for (let i = 0; i < whitePts; i++) arr[idx++] = -1;
  return arr;
}

describe('computeTerritoryStats', () => {
  it('黑多白少 → 黑领先，扣贴目后仍领先', () => {
    const s = computeTerritoryStats({
      ownership: mkOwnership(19, 50, 40),
      boardSize: 19,
      capturedBlack: 3,
      capturedWhite: 5,
      komi: 7.5,
    })!;
    expect(s.blackTerritory).toBe(50);
    expect(s.whiteTerritory).toBe(40);
    expect(s.rawDiff).toBe(10);
    expect(s.finalLead).toBe(2.5); // 10 - 7.5
    expect(s.leader).toBe('black');
    expect(s.capturedBlack).toBe(3);
    expect(s.capturedWhite).toBe(5);
  });

  it('贴目可以扭转领先方（目数差小于贴目）', () => {
    const s = computeTerritoryStats({
      ownership: mkOwnership(19, 45, 40),
      boardSize: 19,
      capturedBlack: 0,
      capturedWhite: 0,
      komi: 7.5,
    })!;
    expect(s.rawDiff).toBe(5);
    expect(s.finalLead).toBe(-2.5);
    expect(s.leader).toBe('white');
  });

  it('正好持平 → leader=even', () => {
    const s = computeTerritoryStats({
      ownership: mkOwnership(19, 47, 40),
      boardSize: 19,
      capturedBlack: 0,
      capturedWhite: 0,
      komi: 7,
    })!;
    expect(s.finalLead).toBe(0);
    expect(s.leader).toBe('even');
  });

  it('小数领地：连续值求和，不做阈值截断', () => {
    const arr = new Float32Array(4);
    arr[0] = 0.8;
    arr[1] = 0.7;
    arr[2] = -0.6;
    arr[3] = 0;
    const s = computeTerritoryStats({
      ownership: arr,
      boardSize: 2,
      capturedBlack: 0,
      capturedWhite: 0,
      komi: 0,
    })!;
    expect(s.blackTerritory).toBe(1.5);
    expect(s.whiteTerritory).toBe(0.6);
  });

  it('死子处理：黑子被判为白领地时不计入黑目', () => {
    // 一个黑子所在点 ownership = -1（判为白地）→ 只加到白目
    const arr = new Float32Array(4);
    arr[0] = -1;
    const s = computeTerritoryStats({
      ownership: arr,
      boardSize: 2,
      capturedBlack: 0,
      capturedWhite: 0,
      komi: 0,
    })!;
    expect(s.blackTerritory).toBe(0);
    expect(s.whiteTerritory).toBe(1);
  });

  it('invalid input → null（缺 ownership / 长度不足 / 尺寸非法）', () => {
    expect(computeTerritoryStats({
      ownership: undefined as unknown as Float32Array,
      boardSize: 19, capturedBlack: 0, capturedWhite: 0, komi: 7.5,
    })).toBeNull();

    expect(computeTerritoryStats({
      ownership: new Float32Array(10), // 不足 361
      boardSize: 19, capturedBlack: 0, capturedWhite: 0, komi: 7.5,
    })).toBeNull();

    expect(computeTerritoryStats({
      ownership: new Float32Array(361),
      boardSize: 0, capturedBlack: 0, capturedWhite: 0, komi: 7.5,
    })).toBeNull();
  });

  it('全 0 ownership（无效数据）→ 目数 0，不崩溃', () => {
    const s = computeTerritoryStats({
      ownership: new Float32Array(361),
      boardSize: 19, capturedBlack: 0, capturedWhite: 0, komi: 7.5,
    })!;
    expect(s.blackTerritory).toBe(0);
    expect(s.finalLead).toBe(-7.5);
    expect(s.leader).toBe('white');
  });

  it('提子数缺省时按 0 处理', () => {
    const s = computeTerritoryStats({
      ownership: mkOwnership(19, 10, 5),
      boardSize: 19,
      capturedBlack: undefined as unknown as number,
      capturedWhite: undefined as unknown as number,
      komi: 7.5,
    })!;
    expect(s.capturedBlack).toBe(0);
    expect(s.capturedWhite).toBe(0);
  });
});

describe('formatLead', () => {
  it('黑领先 / 白领先 / 持平', () => {
    // 用整格 + 一个部分格构造精确目数差，避免整数循环取整误差
    const mk = (diff: number) => {
      const arr = mkOwnership(19, 40, 40);
      arr[360] = diff; // 最后一格承载差值（可为小数，正负均可）
      return computeTerritoryStats({
        ownership: arr, boardSize: 19, capturedBlack: 0, capturedWhite: 0, komi: 0,
      })!;
    };
    expect(formatLead(mk(7.5))).toBe('黑领先 7.5 目');
    expect(formatLead(mk(-3))).toBe('白领先 3.0 目');
    expect(formatLead(mk(0))).toBe('双方持平');
  });
});

describe('territoryVisitsForModel', () => {
  it('小模型(blocks<=10) → 10', () => {
    expect(territoryVisitsForModel({ blocks: 10 })).toBe(TERRITORY_VISITS_SMALL_MODEL);
    expect(territoryVisitsForModel({ blocks: 6 })).toBe(10);
  });

  it('大模型(blocks>10) → 5', () => {
    expect(territoryVisitsForModel({ blocks: 18 })).toBe(TERRITORY_VISITS_LARGE_MODEL);
    expect(territoryVisitsForModel({ blocks: 40 })).toBe(5);
  });

  it('blocks 缺失时从 url 解析 b{num}c', () => {
    expect(territoryVisitsForModel({ url: 'models/g170-b10c128.bin.gz' })).toBe(10);
    expect(territoryVisitsForModel({ url: 'https://x/kata1-b18c384nbt-s999.bin.gz' })).toBe(5);
  });

  it('完全无法判定 → 兜底 10', () => {
    expect(territoryVisitsForModel(null)).toBe(10);
    expect(territoryVisitsForModel(undefined)).toBe(10);
    expect(territoryVisitsForModel({})).toBe(10);
  });

  it('配置里的两个真实模型取值符合预期', () => {
    // model-config.json: g170-b10c128 (10 blocks) / kata1-b18c384nbt (18 blocks)
    expect(territoryVisitsForModel({ blocks: 10, url: 'models/g170-b10c128.bin.gz' })).toBe(10);
    expect(territoryVisitsForModel({ blocks: 18, url: 'https://bot.weiqi.lol/models/kata1-b18c384nbt-*.bin.gz' })).toBe(5);
  });
});
