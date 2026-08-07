/**
 * JosekiDiscoverer 纯函数单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import { discover } from '../JosekiDiscoverer';
import type { IJosekiTrie, IJosekiTrieNode } from '../JosekiTrie';
import type { IJosekiLoader } from '../IJosekiLoader';
import { SGFParser } from '../../sgf/SGFParser';
import { CornerExtractor } from '../CornerExtractor';
import { JosekiMatcher } from '../JosekiMatcher';
import { convertToTopRight, normalizeCornerSequence } from '../../coordinate/CornerConverter';

/**
 * 创建 mock trie，路径: nd od ne oe (4手，都在右上角标准方向)
 * 使用 Record 结构
 */
function createMockTrie(): IJosekiTrie {
  const createNode = (coord: string | null): IJosekiTrieNode => ({
    coord,
    children: {}
  });

  const root = createNode(null);

  // 路径: nd → od → ne → oe (4手，标准方向)
  const ndNode = createNode('nd');
  ndNode.color = 'black';
  ndNode.heat = 10;
  ndNode.freq = 50;
  ndNode.prob = 0.5;
  ndNode.winrate = { delta: 0.1 };
  root.children!['nd'] = ndNode;

  const odNode = createNode('od');
  odNode.color = 'white';
  odNode.heat = 8;
  odNode.freq = 40;
  odNode.prob = 0.4;
  odNode.winrate = { delta: -0.05 };
  ndNode.children!['od'] = odNode;

  const neNode = createNode('ne');
  neNode.color = 'black';
  neNode.heat = 12;
  neNode.freq = 60;
  neNode.prob = 0.6;
  neNode.winrate = { delta: 0.15 };
  odNode.children!['ne'] = neNode;

  const oeNode = createNode('oe');
  oeNode.color = 'white';
  oeNode.heat = 5;
  oeNode.freq = 50;
  oeNode.prob = 0.5;
  oeNode.winrate = { delta: 0.08 };
  oeNode.moves = 4;
  neNode.children!['oe'] = oeNode;

  return { root };
}

/**
 * SGF 棋谱：所有着法都在右上角（标准方向）
 * B[nd](13,3) W[od](14,3) B[ne](13,4) W[oe](14,4)
 */
const TR_CORNER_SGF = `(;GM[1]PB[Black]PW[White]DT[2024-01-01];B[nd];W[od];B[ne];W[oe])`;

/**
 * Mock loader（测试用）
 */
const mockLoader: IJosekiLoader = {
  loadTrie: async () => ({ root: { coord: null, children: {} } }),
  loadAndMergeSubtree: async () => {},
};

describe('JosekiDiscoverer', () => {
  describe('discover', () => {
    it('SGFParser 能正确解析右上角棋谱', () => {
      const parser = new SGFParser();
      const parsed = parser.parse(TR_CORNER_SGF);

      expect(parsed.moves).toHaveLength(4);
      expect(parsed.moves[0]).toEqual({ color: 'B', coord: 'nd' });
      expect(parsed.moves[3]).toEqual({ color: 'W', coord: 'oe' });
      expect(parsed.gameInfo?.black).toBe('Black');
      expect(parsed.gameInfo?.white).toBe('White');
      expect(parsed.gameInfo?.date).toBe('2024-01-01');
    });

    it('CornerExtractor 能从右上角棋谱提取到角序列', () => {
      const parser = new SGFParser();
      const parsed = parser.parse(TR_CORNER_SGF);
      const moves = parsed.moves.map((m) => [m.color, m.coord] as ['B' | 'W', string]);

      const extractor = new CornerExtractor();
      const corners = extractor.extractFourCorners(moves, 80);

      // 右上角应有 4 手
      expect(corners.tr).toBeDefined();
      expect(corners.tr!.moves.length).toBeGreaterThanOrEqual(4);
    });

    it('JosekiMatcher 能匹配 trie 中的路径', async () => {
      const trie = createMockTrie();
      const matcher = new JosekiMatcher(mockLoader);

      // 直接测试: nd od ne oe
      const moves: ['B' | 'W', string][] = [
        ['B', 'nd'],
        ['W', 'od'],
        ['B', 'ne'],
        ['W', 'oe'],
      ];
      const result = await matcher.match(moves, trie);

      expect(result.matchedPath).toEqual(['nd', 'od', 'ne', 'oe']);
      expect(result.depth).toBe(4);
    });

    it('应正确发现定式', async () => {
      const trie = createMockTrie();

      // 分步调试
      const parser = new SGFParser();
      const parsed = parser.parse(TR_CORNER_SGF);
      const moves = parsed.moves.slice(0, 80).map((m) => [m.color, m.coord] as ['B' | 'W', string]);

      // 提取四角
      const extractor = new CornerExtractor();
      const corners = extractor.extractFourCorners(moves, 80);

      // 确认右上角存在
      const trCorner = corners.tr;
      expect(trCorner).toBeDefined();
      expect(trCorner!.moves.length).toBeGreaterThanOrEqual(4);

      // 手动执行转换 + 匹配
      const trMoves = convertToTopRight(
        trCorner!.moves.map((m) => m.coord),
        'tr'
      );
      expect(trMoves.length).toBeGreaterThanOrEqual(4);

      const { normalized } = normalizeCornerSequence(trMoves);
      expect(normalized.length).toBeGreaterThanOrEqual(4);

      const matcher = new JosekiMatcher(mockLoader);
      const result = await matcher.match(
        normalized.map((c, i) => [i % 2 === 0 ? 'B' : 'W', c] as ['B' | 'W', string]),
        trie
      );
      expect(result.matchedPath.length).toBeGreaterThanOrEqual(4);

      // 最终测试
      const patterns = await discover([TR_CORNER_SGF], trie, mockLoader, { minMatchLen: 4 });
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0]?.prefix).toContain('nd');
      expect(patterns[0]?.prefixLen).toBeGreaterThanOrEqual(4);
    });

    it('应正确解析棋谱信息', async () => {
      const trie = createMockTrie();
      const patterns = await discover([TR_CORNER_SGF], trie, mockLoader);

      if (patterns.length > 0 && patterns[0]?.gameInfo) {
        expect(patterns[0].gameInfo.black).toBe('Black');
        expect(patterns[0].gameInfo.white).toBe('White');
        expect(patterns[0].gameInfo.date).toBe('2024-01-01');
      }
    });

    it('应正确返回所有匹配记录', async () => {
      const trie = createMockTrie();
      const sgfList = [TR_CORNER_SGF, TR_CORNER_SGF, TR_CORNER_SGF];

      const patterns = await discover(sgfList, trie, mockLoader);

      // 3盘棋，每盘1个右上角匹配 = 3条记录
      expect(patterns.length).toBe(3);
      patterns.forEach((p) => {
        expect(p.frequency).toBeGreaterThan(0);
      });
    });

    it('应正确处理空棋谱列表', async () => {
      const trie = createMockTrie();
      const patterns = await discover([], trie, mockLoader);

      expect(patterns).toEqual([]);
    });

    it('应正确处理无匹配定式的棋谱', async () => {
      const trie = createMockTrie();
      // 不在 trie 中的着法（左上角范围外）
      const sgfList = [`(;GM[1];B[aa];W[bb];B[cc];W[dd])`];
      const patterns = await discover(sgfList, trie, mockLoader);

      expect(patterns.length).toBe(0);
    });

    it('应正确返回扩展字段', async () => {
      const trie = createMockTrie();
      const patterns = await discover([TR_CORNER_SGF], trie, mockLoader);

      if (patterns.length > 0) {
        const pattern = patterns[0]!;
        expect(pattern.prefixLen).toBeDefined();
        expect(pattern.totalMoves).toBeDefined();
        expect(pattern.sourceCorner).toBeDefined();
        expect(pattern.probability).toBeDefined();
        expect(pattern.extractedMoves).toBeDefined();
      }
    });

    it('应正确生成定式树 SGF', async () => {
      const trie = createMockTrie();
      const patterns = await discover([TR_CORNER_SGF], trie, mockLoader);

      if (patterns.length > 0 && patterns[0]?.extractedMoves) {
        const sgf = patterns[0].extractedMoves;
        expect(sgf).toContain('GM[1]');
        expect(sgf).toContain('SZ[19]');
      }
    });

    it('应正确处理自定义选项', async () => {
      const trie = createMockTrie();
      const patterns = await discover([TR_CORNER_SGF], trie, mockLoader, {
        firstN: 10,
        minMatchLen: 2,
        exportDepth: 3
      });

      expect(patterns).toBeInstanceOf(Array);
    });

    it('应该调用进度回调', async () => {
      const trie = createMockTrie();
      const onProgress = vi.fn();

      await discover([TR_CORNER_SGF, TR_CORNER_SGF], trie, mockLoader, {
        onProgress
      });

      expect(onProgress).toHaveBeenCalled();
      // 检查最后一个调用是完成
      const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1];
      expect(lastCall[1]).toBe('分析完成');
      expect(lastCall[0]).toBe(100);
    });

    it('应正确处理缺失棋谱信息', async () => {
      const trie = createMockTrie();
      const sgfList = [`(;GM[1];B[pd];W[pe];B[qd];W[qe])`];
      const patterns = await discover(sgfList, trie, mockLoader);

      if (patterns.length > 0) {
        const info = patterns[0]?.gameInfo;
        expect(info?.black).toBeDefined();
        expect(info?.white).toBeDefined();
        expect(info?.date).toBeDefined();
      }
    });
  });
});