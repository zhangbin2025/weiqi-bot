import { describe, it, expect } from 'vitest';
import { deserializeTrie } from '../JosekiTrie.js';
import type { IJosekiTrie, IJosekiTrieNode } from '../JosekiTrie.js';

describe('JosekiTrie', () => {
  describe('deserializeTrie', () => {
    it('反序列化空 Trie', () => {
      const json = JSON.stringify({ coord: null, children: {} });
      const trie = deserializeTrie(json);
      expect(trie.root.coord).toBe(null);
      expect(trie.root.children).toEqual({});
    });

    it('反序列化含数据的 Trie', () => {
      const json = JSON.stringify({
        coord: null,
        children: {
          dd: {
            coord: 'dd',
            color: 'black',
            heat: 100,
            children: {
              pp: {
                coord: 'pp',
                color: 'white',
                heat: 50,
                freq: 10,
                prob: 0.5,
                moves: 2,
                children: {}
              }
            }
          }
        }
      });
      const trie = deserializeTrie(json);
      
      expect(trie.root.children?.dd).toBeDefined();
      expect(trie.root.children?.dd.coord).toBe('dd');
      expect(trie.root.children?.dd.color).toBe('black');
      expect(trie.root.children?.dd.heat).toBe(100);
      
      const ddChild = trie.root.children?.dd;
      expect(ddChild.children?.pp).toBeDefined();
      expect(ddChild.children?.pp.freq).toBe(10);
      expect(ddChild.children?.pp.prob).toBe(0.5);
    });

    it('反序列化带胜率统计的 Trie', () => {
      const json = JSON.stringify({
        coord: 'pd',
        color: 'black',
        heat: 200,
        freq: 50,
        prob: 0.3,
        moves: 1,
        winrate: {
          delta: 0.05,
          stddev: 0.02,
          samples: 100
        },
        children: {}
      });
      const node = JSON.parse(json) as IJosekiTrieNode;
      
      expect(node.winrate?.delta).toBe(0.05);
      expect(node.winrate?.stddev).toBe(0.02);
      expect(node.winrate?.samples).toBe(100);
    });

    it('反序列化带子树引用的 Trie', () => {
      const json = JSON.stringify({
        coord: 'pc',
        color: 'black',
        heat: 500,
        subtree: {
          file: 'trie-pc.json.gz',
          josekiCount: 1392
        },
        children: null
      });
      const node = JSON.parse(json) as IJosekiTrieNode;
      
      expect(node.subtree?.file).toBe('trie-pc.json.gz');
      expect(node.subtree?.josekiCount).toBe(1392);
      expect(node.children).toBeNull();
    });
  });
});
