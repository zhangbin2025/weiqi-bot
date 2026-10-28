/**
 * 棋形哈希（puzzleShapeHash）测试
 *
 * @description 验证去重键的核心不变量：
 *   - 平移 / 旋转 / 镜像 不变
 *   - 跨日期、跨序号（内置题库 url 变化）不变
 *   - 不同棋形（含同形不同路数）必须区分开
 */
import { describe, it, expect } from 'vitest';
import { puzzleShapeHash, type PuzzleInitialStone } from '../PuzzleHistoryManager';

const B = (x: number, y: number): PuzzleInitialStone => ({ x, y, color: 'black' });
const W = (x: number, y: number): PuzzleInitialStone => ({ x, y, color: 'white' });

/** 一个典型死活棋形：黑三子被白两子包围 */
const SHAPE: PuzzleInitialStone[] = [
  B(3, 3), B(4, 3), B(5, 3),
  W(3, 4), W(5, 4),
];

describe('puzzleShapeHash 不变量', () => {
  it('无摆子返回 null（空枰题回落 url 去重）', () => {
    expect(puzzleShapeHash([])).toBeNull();
    expect(puzzleShapeHash(undefined)).toBeNull();
    expect(puzzleShapeHash(null)).toBeNull();
  });

  it('整体平移后哈希不变（换日期/换序号的实质就是坐标平移）', () => {
    const moved = SHAPE.map((s) => ({ ...s, x: s.x + 7, y: s.y + 5 }));
    expect(puzzleShapeHash(moved)).toBe(puzzleShapeHash(SHAPE));
  });

  it('旋转 90/180/270 度后哈希不变', () => {
    // 在 19 路内旋转：(x,y) → (y, 18-x)
    const rot = (ss: PuzzleInitialStone[], times: number): PuzzleInitialStone[] => {
      let cur = ss;
      for (let t = 0; t < times; t++) {
        cur = cur.map((s) => ({ ...s, x: s.y, y: 18 - s.x }));
      }
      return cur;
    };
    const h0 = puzzleShapeHash(SHAPE)!;
    expect(puzzleShapeHash(rot(SHAPE, 1))).toBe(h0);
    expect(puzzleShapeHash(rot(SHAPE, 2))).toBe(h0);
    expect(puzzleShapeHash(rot(SHAPE, 3))).toBe(h0);
  });

  it('镜像后哈希不变', () => {
    const mirrored = SHAPE.map((s) => ({ ...s, x: 18 - s.x }));
    expect(puzzleShapeHash(mirrored)).toBe(puzzleShapeHash(SHAPE));
  });

  it('路数参数（boardSize）只做越界校验，不影响哈希', () => {
    // 同一棋形被摆到 9 路 / 19 路盘上，棋形本身未变 → 哈希必须一致
    expect(puzzleShapeHash(SHAPE, 9)).toBe(puzzleShapeHash(SHAPE, 19));
  });

  it('不同棋形哈希不同', () => {
    const other: PuzzleInitialStone[] = [B(3, 3), B(4, 3), W(3, 4)];
    expect(puzzleShapeHash(other)).not.toBe(puzzleShapeHash(SHAPE));
  });

  it('黑白分布不同不算同一题（不能只取坐标集合）', () => {
    // 同样两个位置，全是黑子 vs 一黑一白 —— 是两道不同的题
    const allBlack: PuzzleInitialStone[] = [B(0, 0), B(1, 0)];
    const mixed: PuzzleInitialStone[] = [B(0, 0), W(1, 0)];
    expect(puzzleShapeHash(allBlack)).not.toBe(puzzleShapeHash(mixed));
  });

  it('黑白互换算不同题（黑先 / 白先是两道题）', () => {
    const swapped = SHAPE.map((s) => ({
      ...s,
      color: (s.color === 'black' ? 'white' : 'black') as 'black' | 'white',
    }));
    expect(puzzleShapeHash(swapped)).not.toBe(puzzleShapeHash(SHAPE));
  });

  it('最小路数参与哈希：同形但包围盒跨度不同 → 路数不同 → 哈希不同', () => {
    // 小棋形（跨度 2 → 最小 9 路）与拉开跨度（>13 → 最小 19 路）
    const small: PuzzleInitialStone[] = [B(0, 0), W(1, 1)];
    const spread: PuzzleInitialStone[] = [B(0, 0), W(17, 17)];
    expect(puzzleShapeHash(small)).not.toBe(puzzleShapeHash(spread));
  });

  it('子力数量不同哈希不同（多一子少一子不是同一题）', () => {
    const fewer: PuzzleInitialStone[] = [B(3, 3), B(4, 3), W(3, 4)];
    expect(puzzleShapeHash(fewer)).not.toBe(puzzleShapeHash(SHAPE));
  });

  it('越界脏数据返回 null（宁可回落 url 也不算错棋形）', () => {
    expect(puzzleShapeHash([B(0, 0), B(19, 5)], 19)).toBeNull();
    expect(puzzleShapeHash([B(-1, 0)], 19)).toBeNull();
  });

  it('输出为 32 位小写 hex', () => {
    const h = puzzleShapeHash(SHAPE)!;
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('内置题库跨天场景（回归）', () => {
  it('同一题昨天 url=/4 今天 url=/7：棋形哈希一致，已做数不应重复累加', () => {
    // 题库增删导致整体序号平移，棋形在盘上的绝对坐标随之改变
    const yesterday = SHAPE.map((s) => ({ ...s, x: s.x + 4, y: s.y + 2 }));
    const today = SHAPE.map((s) => ({ ...s, x: s.x + 7, y: s.y + 2 }));
    expect(puzzleShapeHash(yesterday)).toBe(puzzleShapeHash(today));
  });
});
