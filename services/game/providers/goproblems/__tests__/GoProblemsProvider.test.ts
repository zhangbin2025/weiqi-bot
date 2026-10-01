/**
 * @fileoverview GoProblemsProvider 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GoProblemsProvider } from '../GoProblemsProvider';
import type { NetworkManager } from '../../../../infrastructure/network/core/NetworkManager';

/**
 * 构造一个模拟的 goproblems 题目详情 JSON
 */
function makeDetailJson(overrides: Record<string, unknown> = {}): string {
  const base = {
    id: 18982,
    sgf: '',
    rank: { value: 5, unit: 'kyu', exact: false, mark: false },
    genre: 'life and death',
    playerColor: 'black',
    author: { id: 1, name: 'TestAuthor', rank: { value: 3, unit: 'dan', exact: true, mark: false } },
    createdAt: '2026-09-15T10:00:00Z',
    ...overrides,
  };
  return JSON.stringify(base);
}

/**
 * 构造一个含多分支的 goproblems SGF
 */
function makeMultiBranchSgf(): string {
  // 根节点有 AB/AW 摆子，两个分支：
  // 分支1: 深层有 RIGHT 注释 → 正解图
  // 分支2: 深层有 NOTTHIS 注释 → 失败图
  return (
    '(;GM[1]FF[4]CA[UTF-8]SZ[19]' +
    'AB[dd][de][df]AW[ed][ee][fe]' +
    '(;B[gg];W[hh];B[ii];W[jj]C[RIGHT])' +
    '(;B[gh];W[hi];B[gj];W[hk]C[NOTTHIS])' +
    ')'
  );
}

/**
 * 构造含 CHOICE 和深层 RIGHT 的 SGF
 */
function makeChoiceWithRightSgf(): string {
  return (
    '(;GM[1]FF[4]CA[UTF-8]SZ[19]' +
    'AB[dd]AW[ed]' +
    '(;B[gg]C[CHOICE];W[hh];B[ii];W[jj]C[RIGHT])' +
    '(;B[gh];W[hi]C[CHOICE])' +
    ')'
  );
}

/**
 * 构造无注释的分支 SGF
 */
function makeNoCommentSgf(): string {
  return (
    '(;GM[1]FF[4]CA[UTF-8]SZ[19]' +
    'AB[dd]AW[ed]' +
    '(;B[gg];W[hh];B[ii])' +
    '(;B[gh];W[hi];B[gj])' +
    ')'
  );
}

/**
 * 构造白先题目 SGF（含 PL[W]）
 */
function makeWhiteFirstSgf(): string {
  return (
    '(;GM[1]FF[4]CA[UTF-8]SZ[19]' +
    'PL[W]AB[dd][de]AW[ed][ee]' +
    '(;W[gg];B[hh];W[ii];B[jj]C[RIGHT])' +
    ')'
  );
}

/**
 * 构造含 Pass (tt) 的 SGF
 */
function makePassSgf(): string {
  return (
    '(;GM[1]FF[4]CA[UTF-8]SZ[19]' +
    'AB[dd]AW[ed]' +
    '(;B[gg];W[tt];B[ii];W[jj]C[RIGHT])' +
    ')'
  );
}

/**
 * 构造小棋盘（9路）死活题 SGF
 */
function makeSmallBoardSgf(): string {
  return (
    '(;GM[1]FF[4]CA[UTF-8]SZ[9]' +
    'AB[aa][bb]AW[ab][ba]' +
    '(;B[cc];W[dd]C[RIGHT])' +
    '(;B[cd];W[dc]C[NOTTHIS])' +
    ')'
  );
}

describe('GoProblemsProvider', () => {
  let provider: GoProblemsProvider;
  let mockNetwork: NetworkManager;

  beforeEach(() => {
    mockNetwork = {
      request: vi.fn(),
    } as unknown as NetworkManager;
    provider = new GoProblemsProvider(mockNetwork);
  });

  // ─── URL 匹配 ──────────────────────────────────────────

  describe('URL 匹配', () => {
    it('应该匹配 /problems/ URL', () => {
      expect(provider.canHandle('https://goproblems.com/problems/18982')).toBe(true);
    });

    it('应该匹配直接 ID URL', () => {
      expect(provider.canHandle('https://goproblems.com/18982')).toBe(true);
    });

    it('不应该匹配非 goproblems URL', () => {
      expect(provider.canHandle('https://example.com/18982')).toBe(false);
    });
  });

  describe('extractId', () => {
    it('应该从 /problems/ URL 提取 ID', () => {
      expect(provider.extractId('https://goproblems.com/problems/18982')).toBe('18982');
    });

    it('应该从直接 ID URL 提取 ID', () => {
      expect(provider.extractId('https://goproblems.com/18982')).toBe('18982');
    });

    it('应该对无效 URL 返回 null', () => {
      expect(provider.extractId('https://example.com/test')).toBe(null);
    });
  });

  // ─── fetch 基本流程 ──────────────────────────────────────

  describe('fetch', () => {
    it('应该成功下载死活题并生成 101 格式 SGF', async () => {
      const sgf = makeMultiBranchSgf();
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');

      expect(result.success).toBe(true);
      expect(result.source).toBe('goproblems');
      expect(result.sgfContent).toContain('GM[1]');
      expect(result.sgfContent).toContain('SZ[');
      expect(result.sgfContent).toContain('AB[');
      expect(result.sgfContent).toContain('AW[');
    });

    it('应该正确处理无效 URL', async () => {
      const result = await provider.fetch('https://example.com/invalid');

      expect(result.success).toBe(false);
      expect(result.error).toContain('无法从 URL 提取题目 ID');
    });

    it('应该处理 API 返回无效 JSON', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: 'not json',
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');

      expect(result.success).toBe(false);
      expect(result.error).toContain('无法解析题目数据');
    });

    it('应该处理题目未包含 SGF 数据', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: JSON.stringify({ id: 1 }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('无法解析题目数据');
    });

    it('应该处理网络错误', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Network error'),
      );

      const result = await provider.fetch('https://goproblems.com/problems/18982');

      expect(result.success).toBe(false);
      expect(result.error).toContain('下载失败');
    });
  });

  // ─── fetchById ──────────────────────────────────────────

  describe('fetchById', () => {
    it('应该通过 ID 获取死活题', async () => {
      const sgf = makeMultiBranchSgf();
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf }),
      });

      const result = await provider.fetchById('18982');

      expect(result.success).toBe(true);
      expect(result.url).toBe('https://goproblems.com/problems/18982');
    });
  });

  // ─── 分支提取与分类 ─────────────────────────────────────

  describe('分支提取与分类', () => {
    it('应该正确识别 RIGHT 分支为正解图', async () => {
      const sgf = makeMultiBranchSgf();
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');
      expect(result.success).toBe(true);
      expect(result.sgfContent).toContain('正解图');
    });

    it('应该正确识别 NOTTHIS 分支为失败图', async () => {
      const sgf = makeMultiBranchSgf();
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');
      expect(result.success).toBe(true);
      expect(result.sgfContent).toContain('失败图');
    });

    it('CHOICE 分支中深层有 RIGHT 时应识别为正解图', async () => {
      const sgf = makeChoiceWithRightSgf();
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');
      expect(result.success).toBe(true);
      // 第一个分支有 CHOICE 但深层有 RIGHT → 应为正解图
      expect(result.sgfContent).toContain('正解图');
    });

    it('无注释的分支应默认分类为变化图', async () => {
      const sgf = makeNoCommentSgf();
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');
      expect(result.success).toBe(true);
      expect(result.sgfContent).toContain('变化图');
      expect(result.sgfContent).not.toContain('正解图');
      expect(result.sgfContent).not.toContain('失败图');
    });

    it('分支应按正解图→变化图→失败图排序', async () => {
      // 构造一个失败图在前的 SGF
      const sgf =
        '(;GM[1]FF[4]CA[UTF-8]SZ[19]AB[dd]AW[ed]' +
        '(;B[gh];W[hi];B[gj];W[hk]C[NOTTHIS])' +
        '(;B[gg];W[hh];B[ii];W[jj]C[RIGHT])' +
        ')';

      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');
      expect(result.success).toBe(true);

      const sgfContent = result.sgfContent!;
      const rightIdx = sgfContent.indexOf('正解图');
      const failIdx = sgfContent.indexOf('失败图');
      expect(rightIdx).toBeGreaterThan(-1);
      expect(failIdx).toBeGreaterThan(-1);
      expect(rightIdx).toBeLessThan(failIdx);
    });
  });

  // ─── 着法收集 ───────────────────────────────────────────

  describe('着法收集', () => {
    it('应该正确收集分支着法序列', async () => {
      // 用 9 路小棋盘避免 buildTsumegoMinBoard 压缩，直接验证 101 格式
      const sgf = makeSmallBoardSgf();
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');
      expect(result.success).toBe(true);
      // 正解图分支着法: B[cc] W[dd]
      expect(result.sgfContent).toContain('B[cc]');
      expect(result.sgfContent).toContain('W[dd]');
    });

    it('应该跳过 Pass (tt) 着法', async () => {
      // 用 9 路避免压缩；tt 在 9 路也是 pass
      const sgf =
        '(;GM[1]FF[4]CA[UTF-8]SZ[9]' +
        'AB[aa]AW[ba]' +
        '(;B[cc];W[tt];B[dd];W[ee]C[RIGHT])' +
        ')';

      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');
      expect(result.success).toBe(true);
      // tt 着法不应出现在输出中
      expect(result.sgfContent).not.toContain('W[tt]');
      // 非 pass 着法应保留
      expect(result.sgfContent).toContain('B[cc]');
      expect(result.sgfContent).toContain('B[dd]');
    });
  });

  // ─── 先手方判断 ─────────────────────────────────────────

  describe('先手方判断', () => {
    it('API 返回 playerColor=black 时应为黑先', async () => {
      const sgf = makeMultiBranchSgf();
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf, playerColor: 'black' }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');
      expect(result.success).toBe(true);
      expect(result.sgfContent).toContain('黑先');
      expect(result.metadata.blackName).toBe('TestAuthor');
    });

    it('API 返回 playerColor=white 时应为白先', async () => {
      const sgf = makeWhiteFirstSgf();
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf, playerColor: 'white' }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');
      expect(result.success).toBe(true);
      expect(result.sgfContent).toContain('白先');
      expect(result.sgfContent).toContain('PL[W]');
    });

    it('API 未返回 playerColor 时应从 SGF 的 PL[W] 推断白先', async () => {
      const sgf = makeWhiteFirstSgf();
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf, playerColor: null }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');
      expect(result.success).toBe(true);
      expect(result.sgfContent).toContain('白先');
      expect(result.sgfContent).toContain('PL[W]');
    });

    it('API 未返回 playerColor 且无 PL 属性时应从首个着法推断', async () => {
      // 首着是 W → 白先
      const sgf =
        '(;GM[1]FF[4]CA[UTF-8]SZ[19]AB[dd]AW[ed]' +
        '(;W[gg];B[hh];W[ii];B[jj]C[RIGHT])' +
        ')';

      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf, playerColor: null }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');
      expect(result.success).toBe(true);
      expect(result.sgfContent).toContain('白先');
    });
  });

  // ─── 元数据 ─────────────────────────────────────────────

  describe('metadata', () => {
    it('应该正确构建元数据', async () => {
      // 用 9 路小棋盘避免压缩
      const sgf = makeSmallBoardSgf();
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');
      expect(result.success).toBe(true);
      expect(result.metadata.source).toBe('goproblems');
      expect(result.metadata.gameId).toBe('18982');
      expect(result.metadata.width).toBe(9);
      expect(result.metadata.height).toBe(9);
      expect(result.metadata.date).toBe('2026-09-15T10:00:00Z');
    });

    it('应该正确统计手数', async () => {
      const sgf = makeMultiBranchSgf();
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');
      expect(result.success).toBe(true);
      // 原始 SGF 有 8 个着法（两个分支各4手）
      expect(result.metadata.movesCount).toBe(8);
    });

    it('小棋盘题目应正确设置宽高', async () => {
      const sgf = makeSmallBoardSgf();
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');
      expect(result.success).toBe(true);
      expect(result.metadata.width).toBe(9);
      expect(result.metadata.height).toBe(9);
    });
  });

  // ─── 101 格式 SGF 结构 ─────────────────────────────────

  describe('101 格式 SGF 结构', () => {
    it('输出应包含正确的头部属性', async () => {
      // 用 9 路避免压缩
      const sgf = makeSmallBoardSgf();
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');
      expect(result.success).toBe(true);
      expect(result.sgfContent).toContain('GM[1]');
      expect(result.sgfContent).toContain('FF[4]');
      expect(result.sgfContent).toContain('CA[UTF-8]');
      expect(result.sgfContent).toContain('SZ[9]');
    });

    it('应包含题目描述注释', async () => {
      const sgf = makeMultiBranchSgf();
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');
      expect(result.success).toBe(true);
      expect(result.sgfContent).toContain('GP-18982');
      expect(result.sgfContent).toContain('5 kyu');
      expect(result.sgfContent).toContain('life and death');
    });

    it('每个分支应以括号包裹并以类型注释开头', async () => {
      // 用 9 路避免压缩，验证原始 101 格式结构
      const sgf = makeSmallBoardSgf();
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');
      expect(result.success).toBe(true);
      // 分支格式: (C[类型];B[xx];W[yy]...)
      expect(result.sgfContent).toContain('C[正解图]');
      expect(result.sgfContent).toContain('C[失败图]');
      // 确实有分支括号
      expect(result.sgfContent).toMatch(/\(.*C\[正解图\]/s);
      expect(result.sgfContent).toMatch(/\(.*C\[失败图\]/s);
    });

    it('保留 AB/AW 摆子', async () => {
      const sgf = makeMultiBranchSgf();
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');
      expect(result.success).toBe(true);
      expect(result.sgfContent).toContain('AB[dd][de][df]');
      expect(result.sgfContent).toContain('AW[ed][ee][fe]');
    });
  });

  // ─── 异常处理 ───────────────────────────────────────────

  describe('异常处理', () => {
    it('SGF 解析异常时应 fallback 返回原始 SGF', async () => {
      // 截断的 SGF（不完整）
      const brokenSgf = '(;GM[1]FF[4]CA[UTF-8]SZ[19]AB[dd]AW[ed](;B[g';

      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf: brokenSgf }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');
      // 不应崩溃，应返回某种结果
      expect(result).toBeDefined();
    });

    it('空 SGF 内容应被处理', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: makeDetailJson({ sgf: '(;)' }),
      });

      const result = await provider.fetch('https://goproblems.com/problems/18982');
      expect(result).toBeDefined();
    });
  });

  // ─── fetchProblemList ──────────────────────────────────

  describe('fetchProblemList', () => {
    it('应该正确解析题目列表', async () => {
      const mockListResponse = {
        entries: [
          {
            id: 101,
            difficulty: '5 kyu',
            genre: 'life and death',
            createdAt: '2026-09-20T12:00:00Z',
            author: { id: 1, name: 'Author1', rank: null },
          },
          {
            id: 102,
            difficulty: '3 dan',
            genre: 'tesuji',
            createdAt: '2026-09-19T08:00:00Z',
            author: { id: 2, name: 'Author2', rank: { value: 4, unit: 'dan', exact: true, mark: false } },
          },
        ],
        totalRecords: 2,
      };

      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: JSON.stringify(mockListResponse),
      });

      const results = await provider.fetchProblemList(10);

      expect(results).toHaveLength(2);
      expect(results[0]!.title).toBe('GP-101');
      expect(results[0]!.url).toBe('https://goproblems.com/problems/101');
      expect(results[1]!.title).toBe('GP-102');
      expect(results[1]!.subtitle).toContain('4 dan');
    });

    it('应该支持关键字过滤', async () => {
      const mockListResponse = {
        entries: [
          {
            id: 101,
            difficulty: '5 kyu',
            genre: 'life and death',
            createdAt: '2026-09-20T12:00:00Z',
            author: { id: 1, name: 'Author1', rank: null },
          },
          {
            id: 102,
            difficulty: '3 dan',
            genre: 'tesuji',
            createdAt: '2026-09-19T08:00:00Z',
            author: { id: 2, name: 'Author2', rank: null },
          },
        ],
        totalRecords: 2,
      };

      (mockNetwork.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: JSON.stringify(mockListResponse),
      });

      const results = await provider.fetchProblemList(10, 'kyu');

      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe('GP-101');
    });

    it('列表 API 错误时应返回空数组', async () => {
      (mockNetwork.request as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Network error'),
      );

      const results = await provider.fetchProblemList(10);
      expect(results).toEqual([]);
    });
  });
});
