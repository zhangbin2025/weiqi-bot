/**
 * JosekiMatcher 测试
 */

import { describe, it, expect } from 'vitest';
import { JosekiMatcher } from '../../../domain/joseki';
import type { RawMove, IJosekiTrie, IJosekiTrieNode, IJosekiLoader } from '../../../domain/joseki';

/**
 * 构建测试用 Trie（Record 结构）
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

  // 构建测试 Trie
  const trie = buildTestTrie([
    { moves: ['dd', 'pp', 'pd'] },
    { moves: ['dd', 'pp', 'dq'] },
  ]);

  it('应匹配已知定式', async () => {
    const moves: RawMove[] = [
      ['B', 'dd'],
      ['W', 'pp'],
      ['B', 'pd'],
    ];
    const result = await matcher.match(moves, trie);

    expect(result.matchedPath).toEqual(['dd', 'pp', 'pd']);
    expect(result.isComplete).toBe(true);
    expect(result.depth).toBe(3);
  });

  it('应部分匹配定式', async () => {
    const moves: RawMove[] = [
      ['B', 'dd'],
      ['W', 'pp'],
      ['B', 'zz'], // 不存在的着法
    ];
    const result = await matcher.match(moves, trie);

    expect(result.matchedPath).toEqual(['dd', 'pp']);
    expect(result.isComplete).toBe(false);
    expect(result.remainingMoves).toEqual([['B', 'zz']]);
  });

  it('应返回候选着法', async () => {
    // 走两步后的节点
    const moves: RawMove[] = [['B', 'dd'], ['W', 'pp']];
    const result = await matcher.match(moves, trie);

    expect(result.matchedNode).not.toBeNull();
    const candidates = matcher.findNextMoves(result.matchedNode!);

    expect(candidates.length).toBeGreaterThan(0);
    // 应该有 pd 和 dq 两个候选
    const coords = candidates.map((c) => c.coord);
    expect(coords).toContain('pd');
    expect(coords).toContain('dq');
  });

  it('空路径应返回根节点子节点', () => {
    const candidates = matcher.findNextMoves(trie.root);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.coord).toBe('dd');
  });

  it('应按概率排序候选着法', () => {
    const candidates = matcher.findNextMoves(trie.root);

    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1]?.stats.probability).toBeGreaterThanOrEqual(
        candidates[i]?.stats.probability ?? 0
      );
    }
  });
});