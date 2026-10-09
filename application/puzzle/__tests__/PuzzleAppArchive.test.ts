/**
 * PuzzleApp.fetchPuzzle 测试
 * @description 验证抓题时 archiveId 能被带出来（跳打谱页按 archiveId 传递的前提）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PuzzleApp } from '../PuzzleApp';

function makeGameService(result: Record<string, unknown>) {
  return { fetch: vi.fn().mockResolvedValue(result) } as any;
}

describe('PuzzleApp.fetchPuzzle', () => {
  it('成功时同时返回 SGF 与 archiveId', async () => {
    const gs = makeGameService({
      success: true,
      sgfContent: '(;GM[1]SZ[19]AB[pd]AW[dp];B[pp])',
      archiveId: 'arch-123',
      source: 'lib-life-death',
      url: 'lib://life-and-death/2026-10-07/0',
      metadata: {},
      fromCache: false,
    });
    const app = new PuzzleApp(gs);
    const r = await app.fetchPuzzle('lib://life-and-death/2026-10-07/0');
    expect(r).toEqual({
      sgfContent: '(;GM[1]SZ[19]AB[pd]AW[dp];B[pp])',
      archiveId: 'arch-123',
    });
  });

  it('失败时返回 null', async () => {
    const gs = makeGameService({ success: false, error: '网络错误', archiveId: '', sgfContent: null });
    const app = new PuzzleApp(gs);
    expect(await app.fetchPuzzle('lib://bad')).toBeNull();
    expect(gs.fetch).toHaveBeenCalledWith('lib://bad');
  });

  it('成功但归档不可用时 archiveId 为空串（调用方需兜底）', async () => {
    const gs = makeGameService({ success: true, sgfContent: '(;C[x])', archiveId: '' });
    const app = new PuzzleApp(gs);
    const r = await app.fetchPuzzle('lib://x');
    expect(r).toEqual({ sgfContent: '(;C[x])', archiveId: '' });
  });

  it('未注入 gameService 时返回 null', async () => {
    const app = new PuzzleApp(undefined);
    expect(await app.fetchPuzzle('lib://x')).toBeNull();
  });
});

describe('PuzzleApp.fetchPuzzleSGF（保留兼容）', () => {
  it('只返回 SGF 文本', async () => {
    const gs = makeGameService({ success: true, sgfContent: '(;C[hi])', archiveId: 'arch-9' });
    const app = new PuzzleApp(gs);
    expect(await app.fetchPuzzleSGF('lib://x')).toBe('(;C[hi])');
  });

  it('失败时返回 null', async () => {
    const gs = makeGameService({ success: false, error: 'e', archiveId: '', sgfContent: null });
    const app = new PuzzleApp(gs);
    expect(await app.fetchPuzzleSGF('lib://x')).toBeNull();
  });
});
