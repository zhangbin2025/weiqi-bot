import { describe, it, expect } from 'vitest';
import { JosekiMatcher } from '../JosekiMatcher.js';
import type { IJosekiTrie, IJosekiTrieNode, RawMove } from '../index.js';
import type { IJosekiLoader } from '../IJosekiLoader.js';

/**
 * 构建测试用的 Trie（直接用 JSON 结构）
 */
function buildTestTrie(sequences: { moves: string[]; freq?: number; prob?: number }[]): IJosekiTrie {
  const root: IJosekiTrieNode = { coord: null, children: {} };

  for (const seq of sequences) {
    let current = root;
    for (let i = 0; i < seq.moves.length; i++) {
      const coord = seq.moves[i];
      if (!coord || !current.children) continue;

      if (!current.children[coord]) {
        current.children[coord] = {
          coord,
          color: i % 2 === 0 ? 'black' : 'white',
          heat: 1,
          children: {}
        };
      }

      // 最后一着设置 freq/prob
      if (i === seq.moves.length - 1) {
        const node = current.children[coord];
        node.freq = seq.freq ?? 10;
        node.prob = seq.prob ?? 0.5;
        node.moves = seq.moves.length;
      }

      current = current.children[coord];
    }
  }

  return { root };
}

/**
 * Mock loader（测试用）
 */
const mockLoader: IJosekiLoader = {
  loadTrie: async () => ({ root: { coord: null, children: {} } }),
  loadAndMergeSubtree: async () => {},
};

describe('JosekiMatcher', () => {
  const matcher = new JosekiMatcher(mockLoader);

  describe('match', () => {
    it('匹配空序列', async () => {
      const trie = buildTestTrie([]);
      const moves: RawMove[] = [];
      const result = await matcher.match(moves, trie);
      expect(result.matchedPath.length).toBe(0);
      expect(result.depth).toBe(0);
    });

    it('匹配单着定式', async () => {
      const trie = buildTestTrie([{ moves: ['dd'] }]);
      const moves: RawMove[] = [['B', 'dd']];
      const result = await matcher.match(moves, trie);
      expect(result.matchedPath.length).toBe(1);
      expect(result.matchedPath[0]).toBe('dd');
    });

    it('匹配多着定式', async () => {
      const trie = buildTestTrie([{ moves: ['dd', 'pp', 'pd'] }]);
      const moves: RawMove[] = [['B', 'dd'], ['W', 'pp'], ['B', 'pd']];
      const result = await matcher.match(moves, trie);
      expect(result.matchedPath.length).toBe(3);
    });

    it('部分匹配返回剩余着法', async () => {
      const trie = buildTestTrie([{ moves: ['dd', 'pp'] }]);
      const moves: RawMove[] = [['B', 'dd'], ['W', 'pp'], ['B', 'pd']];
      const result = await matcher.match(moves, trie);
      expect(result.matchedPath.length).toBe(2);
      expect(result.remainingMoves.length).toBe(1);
    });

    it('跳过 pass 着法', async () => {
      const trie = buildTestTrie([{ moves: ['dd'] }]);
      const moves: RawMove[] = [['B', 'tt'], ['B', 'dd']];
      const result = await matcher.match(moves, trie);
      expect(result.matchedPath.length).toBe(1);
    });
  });

  describe('findNextMoves', () => {
    it('空节点无候选', () => {
      const trie = buildTestTrie([]);
      const candidates = matcher.findNextMoves(trie.root);
      expect(candidates.length).toBe(0);
    });

    it('有子节点返回候选', async () => {
      const trie = buildTestTrie([{ moves: ['dd', 'pp', 'pd'] }]);
      const result = await matcher.match([['B', 'dd']], trie);
      const candidates = matcher.findNextMoves(result.matchedNode!);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0]?.coord).toBe('pp');
    });
  });

  describe('findBestMove', () => {
    it('无候选返回 null', () => {
      const trie = buildTestTrie([]);
      const best = matcher.findBestMove(trie.root);
      expect(best).toBe(null);
    });

    it('返回概率最高的候选', async () => {
      const trie = buildTestTrie([
        { moves: ['dd', 'pp'], freq: 100, prob: 0.8 },
        { moves: ['dd', 'pd'], freq: 50, prob: 0.2 }
      ]);
      const result = await matcher.match([['B', 'dd']], trie);
      const best = matcher.findBestMove(result.matchedNode!);
      expect(best).not.toBe(null);
      expect(best!.coord).toBe('pp');
      expect(best!.stats.probability).toBe(0.8);
    });
  });
});