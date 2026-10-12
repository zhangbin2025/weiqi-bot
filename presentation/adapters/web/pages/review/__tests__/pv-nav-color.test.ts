/**
 * 变化路径导航圆圈颜色回归测试
 * @module presentation/adapters/web/pages/review/__tests__/pv-nav-color.test.ts
 *
 * 背景（bug）：
 *   showNextPvStep 曾用 `已有着法数 % 2 === 0 ? black : white` 推断下一手颜色，
 *   这等价于硬编码「黑先」。黑先棋谱恰好对得上（所以常规复盘看不出问题），
 *   但白先（PL[W]）/让子棋/死活题白先会整体错一色 —— 显示白圈实际轮黑下。
 *   局面分析模式（死活题、白先排局、让子棋）必现。
 *
 * 修复：直接取 Game.currentPlayer（与 doAddTrialMove 实际落子同源），
 *       Game 已正确处理 PL[] 先手方、让子棋默认白先、pass。
 */
import { describe, it, expect, vi } from 'vitest';
import { ReviewInteraction } from '../ReviewInteraction';
import { Game } from '@domain/game';

type Color = 'black' | 'white';
const opp = (c: Color): Color => (c === 'black' ? 'white' : 'black');

/**
 * board stub：未知方法一律 no-op（Proxy），只特化圆圈相关两个方法，
 * 并记录最后一次绘制的圆圈（clearRecommendationCircles 不清空，便于断言）。
 */
function createBoardStub() {
  const state: any = {
    lastCircles: [],
    setRecommendationCircles: (c: any[]) => { state.lastCircles = c; },
    getClickedRecommendation: (x: number, y: number) =>
      state.lastCircles.find((c: any) => c.x === x && c.y === y) ?? null,
  };
  return new Proxy(state, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      return () => undefined;
    },
  });
}

interface Opts {
  /** PL[] 先手方 */
  initialPlayer: Color;
  /** 局面已下几手（局面分析模式的 moveTo） */
  played: number;
  /** 初始棋子（AB/AW/让子） */
  handicapStones?: Array<{ x: number; y: number; color: Color }>;
}

function setup(opts: Opts) {
  const game = new Game();
  game.newGame({ size: 19 });

  // 初始棋子先摆（setHandicapStones 会把先手方改成白，故随后再 setInitialPlayer）
  const handicap = opts.handicapStones ?? [];
  if (handicap.length > 0) {
    game.setHandicapStones(handicap.map(s => ({ x: s.x, y: s.y, color: s.color === 'black' ? 'B' : 'W' })));
  }
  game.setInitialPlayer(opts.initialPlayer);

  // 局面已下的着法（贴左边缘，不与选点/让子冲突）
  const baseMoves: Array<{ x: number; y: number; color: Color }> = [];
  for (let i = 0; i < opts.played; i++) {
    const color: Color = i % 2 === 0 ? opts.initialPlayer : opp(opts.initialPlayer);
    game.placeStone(0, i);
    baseMoves.push({ x: 0, y: i, color });
  }

  const board = createBoardStub();
  const interaction = new ReviewInteraction(board, game, {
    onModeChange: vi.fn(),
    onStatusUpdate: vi.fn(),
    onDepthChange: vi.fn(),
    onLayerChange: vi.fn(),
    onUndoStateChanged: vi.fn(),
    onStonePlaced: vi.fn(),
    getCurrentMove: () => opts.played,
  });
  interaction.initVariationManager();
  interaction.initializeBaseLayer(baseMoves, handicap, opts.initialPlayer, 19);
  return { board, game, interaction };
}

/** 选点 D16=(3,3)；PV 后续 Q4=(15,15) → R6=(16,13) */
const SEL = { x: 3, y: 3 };
const NEXT1 = { x: 15, y: 15 }; // Q4
const NEXT2 = { x: 16, y: 13 }; // R6

function startGuide(interaction: ReviewInteraction, pv: string[]): void {
  interaction.enterRecommendation([{ x: SEL.x, y: SEL.y, rank: 1, pv }]);
  interaction.handleBoardClick(SEL.x, SEL.y);
}

describe('变化路径导航：圆圈颜色 = 实际落子方', () => {
  it('白先 + 已下 1 手（W）：轮黑落子 → 导航圈应为黑色', () => {
    // 旧实现：着法数 2 → 偶数 → 判黑…（此处恰好同，但下一用例会翻车）
    const { board, game, interaction } = setup({ initialPlayer: 'white', played: 1 });
    expect(game.getState().currentPlayer).toBe('black');

    startGuide(interaction, ['D16', 'Q4']);
    expect(interaction.getMode()).toBe('variation');
    expect(game.getBoard().getStone(SEL.x, SEL.y)).toBe('black'); // 实际落下黑子
    expect(board.lastCircles[0].nextColor).toBe('white');         // 下一个轮白
  });

  it('白先 + 已下 2 手（W,B）：轮白落子 → 导航圈应为黑色', () => {
    const { board, game, interaction } = setup({ initialPlayer: 'white', played: 2 });
    expect(game.getState().currentPlayer).toBe('white');

    startGuide(interaction, ['D16', 'Q4']);
    expect(game.getBoard().getStone(SEL.x, SEL.y)).toBe('white');
    expect(board.lastCircles[0].nextColor).toBe('black'); // 旧实现判 white（错色）
  });

  it('白先 + 已下 4 手（W,B,W,B）：轮白落子 → 导航圈应为黑色', () => {
    const { board, game, interaction } = setup({ initialPlayer: 'white', played: 4 });
    expect(game.getState().currentPlayer).toBe('white');

    startGuide(interaction, ['D16', 'Q4']);
    expect(board.lastCircles[0].nextColor).toBe('black');
  });

  it('让子棋（白先 + 黑让子，0 手）：轮白落子 → 导航圈应为黑色', () => {
    const { board, game, interaction } = setup({
      initialPlayer: 'white',
      played: 0,
      handicapStones: [{ x: 3, y: 15, color: 'black' }, { x: 15, y: 3, color: 'black' }],
    });
    expect(game.getState().currentPlayer).toBe('white');

    startGuide(interaction, ['D16', 'Q4']);
    expect(game.getBoard().getStone(SEL.x, SEL.y)).toBe('white');
    expect(board.lastCircles[0].nextColor).toBe('black'); // 旧实现：着法数 1 → 判 white（错色）
  });

  it('黑先 + 已下 1 手（B）：轮白落子 → 导航圈应为黑色（黑先回归，不能改坏）', () => {
    const { board, game, interaction } = setup({ initialPlayer: 'black', played: 1 });
    expect(game.getState().currentPlayer).toBe('white');

    startGuide(interaction, ['D16', 'Q4']);
    expect(game.getBoard().getStone(SEL.x, SEL.y)).toBe('white');
    expect(board.lastCircles[0].nextColor).toBe('black');
  });

  it('黑先 + 已下 2 手（B,W）：轮黑落子 → 导航圈应为白色（黑先回归）', () => {
    const { board, game, interaction } = setup({ initialPlayer: 'black', played: 2 });
    expect(game.getState().currentPlayer).toBe('black');

    startGuide(interaction, ['D16', 'Q4']);
    expect(game.getBoard().getStone(SEL.x, SEL.y)).toBe('black');
    expect(board.lastCircles[0].nextColor).toBe('white');
  });

  it('沿路径推进：黑白交替（白先 2 手场景）', () => {
    const { board, game, interaction } = setup({ initialPlayer: 'white', played: 2 });
    startGuide(interaction, ['D16', 'Q4', 'R6']);
    expect(board.lastCircles[0].nextColor).toBe('black'); // 白下完，轮黑

    interaction.handleBoardClick(NEXT1.x, NEXT1.y);       // 沿路径点 Q4（黑）
    expect(game.getBoard().getStone(NEXT1.x, NEXT1.y)).toBe('black');
    expect(board.lastCircles[0].nextColor).toBe('white'); // 黑下完，轮白

    interaction.handleBoardClick(NEXT2.x, NEXT2.y);       // 沿路径点 R6（白）
    expect(game.getBoard().getStone(NEXT2.x, NEXT2.y)).toBe('white');
  });

  it('导航圆圈颜色始终等于 Game.currentPlayer（与落子同源，不变量）', () => {
    for (const initialPlayer of ['black', 'white'] as Color[]) {
      for (let played = 1; played <= 4; played++) {
        const { board, game, interaction } = setup({ initialPlayer, played });
        startGuide(interaction, ['D16', 'Q4']);
        expect(board.lastCircles[0].nextColor).toBe(game.getState().currentPlayer);
      }
    }
  });
});
