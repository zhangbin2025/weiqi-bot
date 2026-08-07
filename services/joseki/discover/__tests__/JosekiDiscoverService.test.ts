/**
 * 定式发现服务单元测试（编排层）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JosekiDiscoverService } from '../JosekiDiscoverService';
import type { JosekiLoader } from '../../JosekiLoader';
import type { IConfigProvider } from '../../../infrastructure/config/interfaces/IConfigProvider';
import type { IJosekiTrie, IJosekiTrieNode } from '../../../domain/joseki';

// Mock trie 构建
function createMockTrie(): IJosekiTrie {
  const createNode = (
    probability: number = 0,
    winrateDelta?: number
  ): IJosekiTrieNode => ({
    children: new Map<string, IJosekiTrieNode>(),
    probability,
    winrateDelta,
    frequency: 1,
    coord: '',
  });

  const root = createNode();
  const pdNode = createNode(0.5, 0.1);
  pdNode.coord = 'pd';
  root.children.set('pd', pdNode);
  const ddNode = createNode(0.4, -0.05);
  ddNode.coord = 'dd';
  pdNode.children.set('dd', ddNode);
  const ppNode = createNode(0.6, 0.15);
  ppNode.coord = 'pp';
  ddNode.children.set('pp', ppNode);
  const dpNode = createNode(0.5, 0.08);
  dpNode.coord = 'dp';
  ppNode.children.set('dp', dpNode);

  return { root };
}

describe('JosekiDiscoverService', () => {
  let mockLoader: JosekiLoader;
  let mockConfigProvider: IConfigProvider;
  let service: JosekiDiscoverService;

  beforeEach(() => {
    mockLoader = {
      loadTrie: vi.fn().mockResolvedValue(createMockTrie()),
    } as unknown as JosekiLoader;

    mockConfigProvider = {
      getModuleConfig: vi.fn().mockResolvedValue({
        dataUrl: 'https://example.com',
        trieMetaFile: 'meta.json',
      }),
    } as unknown as IConfigProvider;

    service = new JosekiDiscoverService(mockLoader, mockConfigProvider);
  });

  it('应调用 loader 加载定式库', async () => {
    await service.discoverGames([]);
    expect(mockLoader.loadTrie).toHaveBeenCalledOnce();
  });

  it('应正确编排发现流程', async () => {
    const sgfList = [
      `(;GM[1]PB[Black Player]PW[White Player]DT[2024-01-01];B[pd];W[dd];B[pp];W[dp])`,
    ];

    const result = await service.discoverGames(sgfList);

    expect(result).toBeDefined();
    expect(result.patterns).toBeInstanceOf(Array);
    expect(typeof result.total).toBe('number');
    expect(result.total).toBe(result.patterns.length);
  });

  it('应正确处理空棋谱列表', async () => {
    const result = await service.discoverGames([]);

    expect(result.total).toBe(0);
    expect(result.patterns).toEqual([]);
  });

  it('应正确处理多盘棋谱', async () => {
    const sgfList = [
      `(;GM[1]PB[P1]PW[P2]DT[2024-01-01];B[pd];W[dd];B[pp])`,
      `(;GM[1]PB[P3]PW[P4]DT[2024-01-02];B[pd];W[dd];B[pp])`,
    ];

    const result = await service.discoverGames(sgfList);

    expect(result.patterns).toBeInstanceOf(Array);
  });
});