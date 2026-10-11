/**
 * 停一手（脱先）提示测试
 */
import { describe, it, expect, vi } from 'vitest';
import { NavigationHandler } from '../handlers/NavigationHandler';
import { ReplayPageState } from '../state/ReplayPageState';
import { BoardRebuilder, BoardSyncer } from '../../../../../core/helpers';
import { sgfToReplayData } from '../../../../../../domain/sgf/SGFToReplay';

const SGF_WITH_PASS = '(;GM[1]FF[4]SZ[19]KM[7.5]PB[黑方]PW[白方];B[pd];W[dp];B[pp];W[tt];B[dd];W[qq])';
const SGF_NO_PASS = '(;GM[1]FF[4]SZ[19]KM[7.5]PB[黑方]PW[白方];B[pd];W[dp];B[pp];W[dd])';

function makeHandler(sgf: string) {
  const state = new ReplayPageState();
  const data = sgfToReplayData(sgf)!;
  state.set('replayData', data);
  const handler = new NavigationHandler(
    state,
    {} as any,
    { getIsPlaying: () => false } as any,
    { playSound: vi.fn(), initializeAudio: vi.fn() } as any,
    {} as any,
    {} as any,
    BoardRebuilder,
    BoardSyncer
  );
  return { state, handler, data };
}

describe('停一手（脱先）提示', () => {
  it('能识别出 pass 着法并给出正确的颜色与手数', () => {
    const { state, handler } = makeHandler(SGF_WITH_PASS);
    const cb = vi.fn();
    handler.setOnPassMove(cb);

    // 第 4 手是 W[tt]（脱先）
    state.set('displayIndex', 4);
    handler.notifyPassMove();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(4, 'white');
  });

  it('同一位置不重复提示', () => {
    const { state, handler } = makeHandler(SGF_WITH_PASS);
    const cb = vi.fn();
    handler.setOnPassMove(cb);

    state.set('displayIndex', 4);
    handler.notifyPassMove();
    handler.notifyPassMove();
    handler.notifyPassMove();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('离开该位置后再次回到该位置会重新提示', () => {
    const { state, handler } = makeHandler(SGF_WITH_PASS);
    const cb = vi.fn();
    handler.setOnPassMove(cb);

    state.set('displayIndex', 4);
    handler.notifyPassMove();
    expect(cb).toHaveBeenCalledTimes(1);

    state.set('displayIndex', 5);
    handler.notifyPassMove();
    expect(cb).toHaveBeenCalledTimes(1);

    state.set('displayIndex', 4);
    handler.notifyPassMove();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('正常落子不提示', () => {
    const { state, handler } = makeHandler(SGF_NO_PASS);
    const cb = vi.fn();
    handler.setOnPassMove(cb);

    for (let i = 1; i <= 4; i++) {
      state.set('displayIndex', i);
      handler.notifyPassMove();
    }
    expect(cb).not.toHaveBeenCalled();
  });

  it('第 0 手（根节点）不提示', () => {
    const { state, handler } = makeHandler(SGF_WITH_PASS);
    const cb = vi.fn();
    handler.setOnPassMove(cb);
    state.set('displayIndex', 0);
    handler.notifyPassMove();
    expect(cb).not.toHaveBeenCalled();
  });
});
