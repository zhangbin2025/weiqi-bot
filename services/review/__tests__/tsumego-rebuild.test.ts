/**
 * 非 19 路死活题（AB/AW 摆子 + 非默认先手方）的 rebuild 回归测试
 *
 * 背景：死活题/排局和让子棋一样用 AB[]+AW[] 摆子，但先手方未必是白方（常见 PL[B]）。
 * ReviewService.rebuildBoard 摆完子后若不恢复真实先手方，
 * 整条着法序列的颜色会整体错位 → 落子撞到已有棋子 →
 * 控制台报 "[rebuildBoard] 第N手失败 ... 该位置已有棋子"。
 * 同时 analyzeMoves 必须把棋盘尺寸透传进来，否则会退回 19 路重建。
 */
import { describe, it, expect } from 'vitest';
import { ReviewService } from '../../../services/review/ReviewService';
import { SGFParser } from '../../../domain/sgf/SGFParser';
import type { PlayerColor } from '../../../domain/primitives';

/**
 * 13 路死活题：
 *   白 aa(0,0) 只剩 ba(1,0) 一口气（ab(0,1) 已被黑占）
 *   黑 B[ba] 提掉白 aa → 白 W[jj] → 黑 B[aa] 补回（此时为空点，合法）
 */
const SGF_13_TSUMEGO = '(;GM[1]FF[4]SZ[13]AB[ab]AW[aa]PL[B];B[ba];W[jj];B[aa])';

interface Captured {
  board: any[][];
  previousBoard: any[][] | null;
  currentPlayer: PlayerColor;
  moveHistory: Array<{ x: number; y: number; player: PlayerColor }>;
  initialStones: Array<{ player: PlayerColor; x: number; y: number }>;
}

function makeRecordingAI(captured: Captured[]) {
  return {
    analyze: async (
      board: any[][],
      previousBoard: any[][] | null,
      currentPlayer: PlayerColor,
      moveHistory: Array<{ x: number; y: number; player: PlayerColor }>,
      _komi: number,
      _visits?: number,
      _maxTimeMs?: number,
      _analysisPvLen?: number,
      initialStones?: Array<{ player: PlayerColor; x: number; y: number }>,
    ) => {
      captured.push({ board, previousBoard, currentPlayer, moveHistory, initialStones: initialStones ?? [] });
      return { rootWinRate: 0.5, rootScoreLead: 0, topMoves: [] };
    },
  } as any;
}

/** 跑一遍 analyzeMoves，返回引擎收到的参数 + rebuild 期间的落子失败日志 */
async function runAnalyzeMoves(sgf: string, opts: { withBoardMeta: boolean }) {
  const captured: Captured[] = [];
  const errs: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => { errs.push(args.map(String).join(' ')); };

  try {
    const service = new ReviewService(makeRecordingAI(captured), new SGFParser(), null as any);
    const reviewId = await service.loadFromSGF(sgf);
    const state = service.getState(reviewId)!;
    const moves = service.getMoves(reviewId)!;

    if (opts.withBoardMeta) {
      // 修复后的调用：透传 boardSize + initialPlayer
      await service.analyzeMoves(
        moves, 7.5, {}, state.handicapStones, undefined,
        state.boardSize, state.initialPlayer,
      );
    } else {
      // 修复前的调用：只传摆子
      await service.analyzeMoves(moves, 7.5, {}, state.handicapStones);
    }
    return { state, captured, errs };
  } finally {
    console.error = origError;
  }
}

describe('ReviewService.analyzeMoves — 非 19 路死活题', () => {
  it('应解析出真实棋盘尺寸与先手方', async () => {
    const { state } = await runAnalyzeMoves(SGF_13_TSUMEGO, { withBoardMeta: true });
    expect(state.boardSize).toBe(13);
    expect(state.initialPlayer).toBe('black');
    expect(state.handicapStones.length).toBeGreaterThan(0);
  });

  it('透传 boardSize/initialPlayer 后：棋盘为 13 路、提子与颜色正确、无落子失败', async () => {
    const { captured, errs } = await runAnalyzeMoves(SGF_13_TSUMEGO, { withBoardMeta: true });
    const { board } = captured[0]!;

    // 棋盘尺寸必须是真实的 13 路，而不是默认 19 路
    expect(board.length).toBe(13);
    expect(board[0]!.length).toBe(13);

    // 黑 B[ba] 提掉白 aa，黑再 B[aa] 落回 → aa 应为黑
    expect(board[0]![0]).toBe('black');
    // 白 W[jj]
    expect(board[9]![9]).toBe('white');
    // 摆子 AB[ab]
    expect(board[1]![0]).toBe('black');

    // 整个 rebuild 过程不应有任何一手落子失败
    expect(errs.filter((e) => e.includes('rebuildBoard')).length).toBe(0);
  });

  it('currentPlayer 应为最后一手的对手', async () => {
    const { captured } = await runAnalyzeMoves(SGF_13_TSUMEGO, { withBoardMeta: true });
    // 最后一手是黑 B[aa] → 轮到白
    expect(captured[0]!.currentPlayer).toBe('white');
  });

  it('摆子（initialStones）应完整传给引擎', async () => {
    const { state, captured } = await runAnalyzeMoves(SGF_13_TSUMEGO, { withBoardMeta: true });
    const stones = captured[0]!.initialStones;
    expect(stones.length).toBe(state.handicapStones.length);
    expect(stones.some((s) => s.player === 'black' && s.x === 0 && s.y === 1)).toBe(true); // AB[ab]
    expect(stones.some((s) => s.player === 'white' && s.x === 0 && s.y === 0)).toBe(true); // AW[aa]
  });

  it('（回归守护）旧调用缺少 boardSize 时会退回 19 路并触发重建失败', async () => {
    const { captured, errs } = await runAnalyzeMoves(SGF_13_TSUMEGO, { withBoardMeta: false });
    // 守护：一旦这里不再失败，说明默认参数被改成正确值了，本用例可相应调整
    expect(captured[0]!.board.length).toBe(19);
    expect(errs.some((e) => e.includes('该位置已有棋子'))).toBe(true);
  });
});
