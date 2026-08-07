/**
 * JosekiExplorer 测试
 */

import { describe, it, expect } from 'vitest';
import { JosekiExplorer } from '../JosekiExplorer';
import type { IJosekiTrie, IJosekiTrieNode } from '../JosekiTrie';
import type { IJosekiLoader } from '../IJosekiLoader';

/**
 * 构建测试用 Trie（Record 结构）
 */
function buildTestTrie(sequences: { moves: string[]; freq?: number }[]): IJosekiTrie {
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
        node.prob = 0.5;
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

describe('JosekiExplorer', () => {
  // 构建测试 Trie
  const trie = buildTestTrie([
    { moves: ['dd', 'pp', 'pd', 'dp'] },
  ]);

  it('应正确落子和撤销', async () => {
    const explorer = new JosekiExplorer(trie, mockLoader);

    // 落子
    expect(await explorer.playMove('dd')).toBe(true);
    expect(explorer.getCurrentPath()).toEqual(['dd']);

    // 继续落子
    expect(await explorer.playMove('pp')).toBe(true);
    expect(explorer.getCurrentPath()).toEqual(['dd', 'pp']);

    // 撤销
    expect(explorer.undo()).toBe(true);
    expect(explorer.getCurrentPath()).toEqual(['dd']);

    // 撤销到根
    expect(explorer.undo()).toBe(true);
    expect(explorer.getCurrentPath()).toEqual([]);
  });

  it('无效着法应返回 false', async () => {
    const explorer = new JosekiExplorer(trie, mockLoader);

    expect(await explorer.playMove('zz')).toBe(false);
    expect(explorer.getCurrentPath()).toEqual([]);
  });

  it('根节点撤销应返回 false', () => {
    const explorer = new JosekiExplorer(trie, mockLoader);

    expect(explorer.undo()).toBe(false);
  });

  it('重置应回到根节点', async () => {
    const explorer = new JosekiExplorer(trie, mockLoader);

    await explorer.playMove('dd');
    await explorer.playMove('pp');
    explorer.reset();

    expect(explorer.getCurrentPath()).toEqual([]);
  });

  it('应获取候选着法', () => {
    const explorer = new JosekiExplorer(trie, mockLoader);

    const candidates = explorer.getCandidateMoves();

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.coord).toBe('dd');
  });

  it('应获取当前统计', async () => {
    const explorer = new JosekiExplorer(trie, mockLoader);

    await explorer.playMove('dd');
    await explorer.playMove('pp');

    const stats = explorer.getCurrentStats();

    expect(stats.movesCount).toBe(2);
  });

  it('应检查是否完整', async () => {
    const explorer = new JosekiExplorer(trie, mockLoader);

    // 走完所有步
    await explorer.playMove('dd');
    await explorer.playMove('pp');
    await explorer.playMove('pd');
    await explorer.playMove('dp');

    expect(explorer.isComplete()).toBe(true);
  });
});