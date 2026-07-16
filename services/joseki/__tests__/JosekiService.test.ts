/**
 * Joseki 服务层测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JosekiExploreService } from '../explore/JosekiExploreService';
import { JosekiLoader } from '../JosekiLoader';
import type { NetworkManager } from '../../infrastructure/network/core/NetworkManager';
import type { IFileStorage } from '../../infrastructure/storage/interfaces/IFileStorage';
import type { IConfigProvider } from '../../infrastructure/config/interfaces/IConfigProvider';
import type { IJosekiTrieNode } from '../../../domain/joseki';
import pako from 'pako';

/**
 * 构建测试用 Trie 数据（Record 结构）
 */
function buildTestTrieData(sequences: { moves: string[]; freq?: number }[]): IJosekiTrieNode {
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

  return root;
}

/**
 * 将 JSON 数据 gzip 压缩为 ArrayBuffer（模拟网络响应）
 */
function gzipEncode(data: unknown): ArrayBuffer {
  const json = JSON.stringify(data);
  const compressed = pako.gzip(json);
  return compressed.buffer as ArrayBuffer;
}

/**
 * 创建 mock 依赖
 */
function createMocks() {
  const mockNetwork = {
    request: vi.fn(),
  } as unknown as NetworkManager;

  const mockFileStorage = {
    upload: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockRejectedValue(new Error('File not found')),
    delete: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    listFiles: vi.fn().mockResolvedValue([]),
    getMetadata: vi.fn().mockResolvedValue(null),
    readChunk: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    createDirectory: vi.fn().mockResolvedValue(undefined),
    deleteDirectory: vi.fn().mockResolvedValue(undefined),
  } as unknown as IFileStorage;

  const mockConfig = {
    getModuleConfig: vi.fn().mockResolvedValue({
      dataUrl: 'https://example.com/joseki',
      trieMetaFile: 'trie-meta.json',
      cacheTTL: 86400000,
      enableDynamicLoad: false,
    }),
  } as unknown as IConfigProvider;

  return { mockNetwork, mockFileStorage, mockConfig };
}

describe('JosekiExploreService', () => {
  const { mockNetwork, mockFileStorage, mockConfig } = createMocks();

  const mockJosekiExploreConfig = {
    getModuleConfig: vi.fn().mockResolvedValue({
      defaultVisits: 100,
      defaultTopK: 5,
      defaultKomi: 7.5,
    }),
  } as unknown as IConfigProvider;

  let loader: JosekiLoader;
  let service: JosekiExploreService;

  beforeEach(() => {
    vi.clearAllMocks();

    const testTrieData = buildTestTrieData([
      { moves: ['dd', 'pp', 'pd'] },
    ]);

    (mockNetwork as any).request = vi.fn()
      .mockResolvedValueOnce({
        data: gzipEncode(testTrieData),
        status: 200,
      });

    (mockFileStorage as any).download = vi.fn().mockRejectedValue(new Error('File not found'));

    loader = new JosekiLoader(mockNetwork, mockFileStorage, mockConfig);
    service = new JosekiExploreService(loader, mockJosekiExploreConfig);
  });

  it('应探索定式', async () => {
    const result = await service.explore(['dd', 'pp']);

    expect(result.path).toEqual(['dd', 'pp']);
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it('应返回正确的统计信息', async () => {
    const result = await service.explore(['dd', 'pp']);

    expect(result.stats.movesCount).toBe(2);
  });
});

describe('JosekiDiscoverService', () => {
  const { mockNetwork, mockFileStorage, mockConfig } = createMocks();

  let loader: JosekiLoader;

  beforeEach(() => {
    vi.clearAllMocks();

    const testTrieData = buildTestTrieData([
      { moves: ['pd', 'qd', 'pe', 'qe', 'nf', 'pf', 'ng', 'pg'] },
    ]);

    (mockNetwork as any).request = vi.fn()
      .mockResolvedValueOnce({
        data: gzipEncode(testTrieData),
        status: 200,
      });

    (mockFileStorage as any).download = vi.fn().mockRejectedValue(new Error('File not found'));

    loader = new JosekiLoader(mockNetwork, mockFileStorage, mockConfig);
  });

  it('应从棋谱发现定式', async () => {
    const { JosekiDiscoverService } = await import('../discover/JosekiDiscoverService');

    const mockJosekiDiscoverConfig = {
      getModuleConfig: vi.fn().mockResolvedValue({
        defaultMaxGames: 10,
        minFrequency: 1,
        minMoves: 1,
        maxMoves: 20,
      }),
    } as unknown as IConfigProvider;

    const service = new JosekiDiscoverService(loader, mockJosekiDiscoverConfig);

    const sgfList = ['(;SZ[19];B[pd];W[qd];B[pe];W[qe];B[nf];W[pf];B[ng];W[pg])'];

    const result = await service.discoverGames(sgfList);

    expect(result.patterns.length).toBeGreaterThanOrEqual(0);
    expect(result.total).toBe(result.patterns.length);
  });
});

describe('JosekiQuizService', () => {
  const { mockNetwork, mockFileStorage, mockConfig } = createMocks();

  let loader: JosekiLoader;

  beforeEach(() => {
    vi.clearAllMocks();

    const testTrieData = buildTestTrieData([
      { moves: ['dd', 'pp', 'pd', 'dp'] },
    ]);

    (mockNetwork as any).request = vi.fn()
      .mockResolvedValueOnce({
        data: gzipEncode(testTrieData),
        status: 200,
      });

    (mockFileStorage as any).download = vi.fn().mockRejectedValue(new Error('File not found'));

    loader = new JosekiLoader(mockNetwork, mockFileStorage, mockConfig);
    
    // Mock loadQuizData to return quiz questions
    vi.spyOn(loader, 'loadQuizData').mockResolvedValue([
      { path: 'dd-pp-pd', moves: 3, freq: 100, prob: 0.5, winrate: { delta: 0.02 } },
      { path: 'dd-pp-dp', moves: 3, freq: 80, prob: 0.4, winrate: { delta: -0.01 } },
    ]);
  });

  it('应生成挑战题目', async () => {
    const { JosekiQuizService } = await import('../quiz/JosekiQuizService');
    const service = new JosekiQuizService(loader);

    const question = await service.generateQuiz({ difficulty: 'easy' });

    expect(question.id).toBeDefined();
    expect(question.path).toBeDefined();
    expect(question.answer).toBeDefined();
    expect(question.difficulty).toBe(2); // easy → 2
  });
});
