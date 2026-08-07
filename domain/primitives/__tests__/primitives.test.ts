import { describe, it, expect } from 'vitest';
import {
  getOpponentColor,
  sgfColorToPlayerColor,
  playerColorToSGFColor,
  createStone,
  isSamePosition,
  isSameStone,
  getStoneKey,
} from '../index';
import type { PlayerColor, SGFColor, IStone } from '../index';

// ===== IPlayer 模块 =====

describe('getOpponentColor', () => {
  it('黑方对手是白方', () => {
    expect(getOpponentColor('black')).toBe('white');
  });

  it('白方对手是黑方', () => {
    expect(getOpponentColor('white')).toBe('black');
  });
});

describe('sgfColorToPlayerColor', () => {
  it('B 转为 black', () => {
    expect(sgfColorToPlayerColor('B')).toBe('black');
  });

  it('W 转为 white', () => {
    expect(sgfColorToPlayerColor('W')).toBe('white');
  });

  it('遍历所有 SGFColor 值', () => {
    const colors: SGFColor[] = ['B', 'W'];
    const results: PlayerColor[] = colors.map(sgfColorToPlayerColor);
    expect(results).toEqual(['black', 'white']);
  });
});

describe('playerColorToSGFColor', () => {
  it('black 转为 B', () => {
    expect(playerColorToSGFColor('black')).toBe('B');
  });

  it('white 转为 W', () => {
    expect(playerColorToSGFColor('white')).toBe('W');
  });

  it('颜色转换往返一致', () => {
    const colors: PlayerColor[] = ['black', 'white'];
    for (const color of colors) {
      const sgf = playerColorToSGFColor(color);
      const back = sgfColorToPlayerColor(sgf);
      expect(back).toBe(color);
    }
  });
});

// ===== IStone 模块 =====

describe('createStone', () => {
  it('创建黑子', () => {
    const stone = createStone(3, 3, 'black');
    expect(stone).toEqual({ x: 3, y: 3, color: 'black' });
  });

  it('创建白子', () => {
    const stone = createStone(10, 15, 'white');
    expect(stone).toEqual({ x: 10, y: 15, color: 'white' });
  });

  it('创建坐标 (0,0) 的棋子', () => {
    const stone = createStone(0, 0, 'black');
    expect(stone.x).toBe(0);
    expect(stone.y).toBe(0);
  });

  it('创建角上棋子 (18,18)', () => {
    const stone = createStone(18, 18, 'white');
    expect(stone.x).toBe(18);
    expect(stone.y).toBe(18);
  });
});

describe('isSamePosition', () => {
  it('相同位置返回 true', () => {
    const s1 = createStone(3, 3, 'black');
    const s2 = createStone(3, 3, 'white');
    expect(isSamePosition(s1, s2)).toBe(true);
  });

  it('不同位置返回 false', () => {
    const s1 = createStone(3, 3, 'black');
    const s2 = createStone(3, 4, 'black');
    expect(isSamePosition(s1, s2)).toBe(false);
  });

  it('颜色不同但位置相同返回 true', () => {
    const s1 = createStone(5, 5, 'black');
    const s2 = createStone(5, 5, 'white');
    expect(isSamePosition(s1, s2)).toBe(true);
  });
});

describe('isSameStone', () => {
  it('位置和颜色都相同返回 true', () => {
    const s1 = createStone(3, 3, 'black');
    const s2 = createStone(3, 3, 'black');
    expect(isSameStone(s1, s2)).toBe(true);
  });

  it('位置相同但颜色不同返回 false', () => {
    const s1 = createStone(3, 3, 'black');
    const s2 = createStone(3, 3, 'white');
    expect(isSameStone(s1, s2)).toBe(false);
  });

  it('颜色相同但位置不同返回 false', () => {
    const s1 = createStone(3, 3, 'black');
    const s2 = createStone(4, 3, 'black');
    expect(isSameStone(s1, s2)).toBe(false);
  });

  it('位置和颜色都不同返回 false', () => {
    const s1 = createStone(3, 3, 'black');
    const s2 = createStone(4, 4, 'white');
    expect(isSameStone(s1, s2)).toBe(false);
  });
});

describe('getStoneKey', () => {
  it('生成 "x,y" 格式键', () => {
    const stone = createStone(3, 5, 'black');
    expect(getStoneKey(stone)).toBe('3,5');
  });

  it('原点生成 "0,0"', () => {
    const stone = createStone(0, 0, 'white');
    expect(getStoneKey(stone)).toBe('0,0');
  });

  it('不同位置生成不同键', () => {
    const s1 = createStone(3, 5, 'black');
    const s2 = createStone(5, 3, 'black');
    expect(getStoneKey(s1)).not.toBe(getStoneKey(s2));
  });

  it('同位置不同颜色生成相同键', () => {
    const s1 = createStone(3, 5, 'black');
    const s2 = createStone(3, 5, 'white');
    expect(getStoneKey(s1)).toBe(getStoneKey(s2));
  });
});
