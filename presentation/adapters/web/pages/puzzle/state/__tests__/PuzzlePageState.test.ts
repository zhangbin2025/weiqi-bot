/**
 * PuzzlePageState 回归测试
 * @description 重点锁定「无题可出时必须清空题目自身」这一行为：
 *              筛选题型/难度无结果时，若只重置答题进度而保留 SGF/局面/题号，
 *              页面会显示上一道题的局面 + 空态提示，用户误以为筛选没生效。
 */
import { describe, it, expect } from 'vitest';
import { PuzzlePageState } from '../PuzzlePageState';

describe('PuzzlePageState', () => {
  /** 造一个「正在做某道题」的状态 */
  function withLoadedPuzzle(): PuzzlePageState {
    const st = new PuzzlePageState();
    st.set('sgfContent', '(;GM[1]SZ[19]AB[dd][dp])');
    st.set('archiveId', 'arch-123');
    st.set('replayData', { board_size: 19 } as never);
    st.set('title', '#42');
    st.set('tag', '\u6b7b\u6d3b\u9898\u00b75D');
    st.set('url', 'lib://life-and-death/2026-10-12/42');
    st.set('mode', 'study');
    st.set('solved', true);
    st.set('attempts', 3);
    st.set('startedAt', 12345);
    st.set('firstPlayer', 'W');
    return st;
  }

  it('resetForNewPuzzle 只重置答题进度，保留题目本身', () => {
    const st = withLoadedPuzzle();
    st.resetForNewPuzzle();

    // 题目还在：载入新题前的重置，不能把当前题抹掉
    expect(st.get('url')).toBe('lib://life-and-death/2026-10-12/42');
    expect(st.get('title')).toBe('#42');
    expect(st.get('replayData')).not.toBeNull();
    // 答题进度已归零
    expect(st.get('solved')).toBe(false);
    expect(st.get('attempts')).toBe(0);
    expect(st.get('mode')).toBe('solve');
    expect(st.get('startedAt')).toBeGreaterThan(0);
  });

  it('clearPuzzle 清空题目自身（筛选无结果时调用）', () => {
    const st = withLoadedPuzzle();
    st.clearPuzzle();

    expect(st.get('sgfContent')).toBeNull();
    expect(st.get('archiveId')).toBe('');
    expect(st.get('replayData')).toBeNull();
    expect(st.get('title')).toBe('');
    expect(st.get('tag')).toBe('');
    expect(st.get('url')).toBe('');
    // 答题进度同样归零
    expect(st.get('solved')).toBe(false);
    expect(st.get('attempts')).toBe(0);
    expect(st.get('mode')).toBe('solve');
    expect(st.get('startedAt')).toBe(0);
    expect(st.get('firstPlayer')).toBe('B');
  });

  it('clearPuzzle 后不残留可用于渲染/写历史的题目信息', () => {
    const st = withLoadedPuzzle();
    st.clearPuzzle();
    // url 为空 → recordAttempt 会直接返回，不会把空题写进历史
    expect(st.get('url')).toBeFalsy();
    // replayData 为空 → refresh() 走空态分支，不再重放旧局面
    expect(st.get('replayData')).toBeFalsy();
  });
});
