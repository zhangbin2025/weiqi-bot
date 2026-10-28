/**
 * 棋形哈希回归测试：内置题库「已做数突破总数」场景
 *
 * @description 复现用户报障：筛选后共 499 题，做完 499 题后继续做重复题，
 *              已做数涨到 500、501（因为 url 含日期且每天变，按 url 去重失效）。
 *              改为按「初始局面棋形」去重后，重复做同一题不应再累加。
 */
import { describe, it, expect } from "vitest";
import { puzzleShapeHash, type PuzzleInitialStone } from "../PuzzleHistoryManager";

/** 简易 LCG，保证可复现 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 生成一道随机的死活题初始局面（坐标均在 19 路内，保证有子） */
function randomShape(rnd: () => number): PuzzleInitialStone[] {
  const used = new Set<string>();
  const stones: PuzzleInitialStone[] = [];
  const n = 3 + Math.floor(rnd() * 5); // 3~7 子
  for (let k = 0; k < n; k++) {
    let x = 0;
    let y = 0;
    let key = "";
    do {
      x = Math.floor(rnd() * 19);
      y = Math.floor(rnd() * 19);
      key = `${x},${y}`;
    } while (used.has(key));
    used.add(key);
    stones.push({ x, y, color: rnd() < 0.5 ? "black" : "white" });
  }
  return stones;
}

describe("已做数不突破总数（回归）", () => {
  it("500 道不同的题产生 500 个不同棋形键", () => {
    const rnd = lcg(20261028);
    const shapes: PuzzleInitialStone[][] = [];
    for (let i = 0; i < 500; i++) shapes.push(randomShape(rnd));
    const keys = new Set(shapes.map((s) => puzzleShapeHash(s, 19)!));
    expect(keys.size).toBe(500);
  });

  it("做完 499 题后反复重做第 1 题，已做数保持 499（不涨到 500/501）", () => {
    const rnd = lcg(20261028);
    const shapes: PuzzleInitialStone[][] = [];
    for (let i = 0; i < 499; i++) shapes.push(randomShape(rnd));
    const done = new Set(shapes.map((s) => puzzleShapeHash(s, 19)!));
    expect(done.size).toBe(499);
    // 重做第 1 题（同一棋形）—— 关键回归点
    done.add(puzzleShapeHash(shapes[0]!, 19)!);
    expect(done.size).toBe(499);
    done.add(puzzleShapeHash(shapes[0]!, 19)!);
    expect(done.size).toBe(499);
  });

  it("跨天换 url（整体平移）后同一题棋形键不变", () => {
    const rnd = lcg(7);
    const s = randomShape(rnd);
    // 模拟题库更新导致坐标整体平移（且平移后仍在 19 路内）
    const moved = s
      .map((p) => ({ ...p, x: p.x + 2, y: p.y + 1 }))
      .filter((p) => p.x < 19 && p.y < 19);
    if (moved.length !== s.length) return; // 平移越界则该样例跳过
    expect(puzzleShapeHash(moved, 19)).toBe(puzzleShapeHash(s, 19));
  });

  it("最小路数参与哈希：包围盒跨度不同则 n 不同，哈希不同", () => {
    const small: PuzzleInitialStone[] = [
      { x: 0, y: 0, color: "black" },
      { x: 1, y: 1, color: "white" },
    ];
    const spread: PuzzleInitialStone[] = [
      { x: 0, y: 0, color: "black" },
      { x: 15, y: 15, color: "white" },
    ];
    expect(puzzleShapeHash(small, 19)).not.toBe(puzzleShapeHash(spread, 19));
  });
});
