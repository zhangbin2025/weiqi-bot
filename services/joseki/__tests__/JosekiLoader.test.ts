/**
 * JosekiLoader 测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('JosekiLoader', () => {
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

  let loader: JosekiLoader;

  beforeEach(() => {
    vi.clearAllMocks();
    loader = new JosekiLoader(mockNetwork, mockFileStorage, mockConfig);
  });

  it('应从网络加载 Trie', async () => {
    const testTrieData = buildTestTrieData([
      { moves: ['dd', 'pp'] },
    ]);

    (mockNetwork as any).request = vi.fn()
      .mockResolvedValueOnce({
        data: gzipEncode(testTrieData),
        status: 200,
      });

    (mockFileStorage as any).download = vi.fn().mockRejectedValue(new Error('File not found'));

    const trie = await loader.loadTrie();

    expect(trie).toBeDefined();
    expect(trie.root).toBeDefined();
    expect(mockFileStorage.upload).toHaveBeenCalled();
  });

  it('应从文件存储加载 Trie', async () => {
    const testTrieData = buildTestTrieData([
      { moves: ['dd', 'pp'] },
    ]);

    // 文件存储返回 gzip 压缩的数据
    (mockFileStorage as any).download = vi.fn()
      .mockResolvedValueOnce(new Blob([gzipEncode(testTrieData)]));

    const trie = await loader.loadTrie();

    expect(trie).toBeDefined();
    expect(trie.root.children?.dd).toBeDefined();
    // 网络不应被调用
    expect(mockNetwork.request).not.toHaveBeenCalled();
  });

  it('应加载元数据', async () => {
    (mockNetwork as any).request = vi.fn().mockResolvedValue({
      data: {
        version: '2.0',
        threshold: 1000,
        total: 100,
        subtrees: 10,
        difficulty: { easy: 50, medium: 30, hard: 20 },
        indexSize: 35000
      },
      status: 200,
    });

    const meta = await loader.loadMeta();

    expect(meta.total).toBe(100);
    expect(meta.version).toBe('2.0');
  });

  it('清除缓存应清空数据', async () => {
    (mockFileStorage as any).listFiles = vi.fn().mockResolvedValue([
      'joseki/trie-index.json.gz',
      'joseki/quiz-easy.json.gz',
    ]);

    await loader.clearCache();

    expect(mockFileStorage.delete).toHaveBeenCalledTimes(2);
  });
});