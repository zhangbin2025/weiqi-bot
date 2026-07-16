/**
 * 定式数据加载器
 * @description 处理定式 Trie 的加载、gzip 解压、本地缓存、子树按需加载
 */

import type { NetworkManager } from '../../infrastructure/network/core/NetworkManager';
import type { IFileStorage } from '../../infrastructure/storage/interfaces/IFileStorage';
import type { IConfigProvider } from '../../infrastructure/config/interfaces/IConfigProvider';
import type { IJosekiTrie, IJosekiTrieNode } from '../../domain/joseki';
import type { IJosekiConfig } from '../../infrastructure/config/schemas/JosekiConfigSchema';
import type { IJosekiLoader, IJosekiMeta, LoadProgressCallback, QuizQuestion } from './IJosekiLoader';
import { GzipJsonLoader } from './GzipJsonLoader';
import { JosekiQuizLoader } from './JosekiQuizLoader';

/**
 * 定式加载器
 */
export class JosekiLoader implements IJosekiLoader {
  private trie: IJosekiTrie | null = null;
  private meta: IJosekiMeta | null = null;
  private subtreeCache: Map<string, IJosekiTrieNode> = new Map();
  private gzipLoader: GzipJsonLoader;
  private quizLoader: JosekiQuizLoader;

  constructor(
    private readonly network: NetworkManager,
    private readonly fileStorage: IFileStorage,
    private readonly configProvider: IConfigProvider,
  ) {
    this.gzipLoader = new GzipJsonLoader(network, fileStorage);
    this.quizLoader = new JosekiQuizLoader(this.gzipLoader, configProvider);
  }

  /**
   * 获取数据路径
   */
  async getDataUrl(): Promise<string> {
    const config = await this.configProvider.getModuleConfig<IJosekiConfig>('joseki');
    return config.dataUrl;
  }

  /**
   * 加载索引（trie-index.json.gz）
   */
  async loadTrie(onProgress?: LoadProgressCallback): Promise<IJosekiTrie> {
    if (this.trie) {
      onProgress?.(100, '已加载');
      return this.trie;
    }

    const dataUrl = await this.getDataUrl();

    onProgress?.(0, '下载定式索引');
    const rootNode = await this.gzipLoader.load<IJosekiTrieNode>(
      `${dataUrl}/trie-index.json.gz`,
      'joseki/trie-index.json.gz',
      onProgress,
    );
    onProgress?.(100, '加载完成');

    this.trie = { root: rootNode };
    return this.trie;
  }

  /**
   * 加载元数据（trie-meta.json）
   */
  async loadMeta(): Promise<IJosekiMeta> {
    if (this.meta) {
      return this.meta;
    }

    const dataUrl = await this.getDataUrl();

    // meta 文件很小，不需要缓存
    const response = await this.network.request<IJosekiMeta>({
      url: `${dataUrl}/trie-meta.json`,
      method: 'GET',
    });

    this.meta = response.data ?? {
      version: '2.0',
      threshold: 1000,
      total: 0,
      subtrees: 0,
      difficulty: { easy: 0, medium: 0, hard: 0 },
      indexSize: 0,
    };

    return this.meta;
  }

  /**
   * 按需加载子树
   * @param prefix - 子树前缀，如 'pc' 或 'pc-qe'
   */
  async loadSubtree(prefix: string, onProgress?: LoadProgressCallback): Promise<IJosekiTrieNode> {
    // 检查内存缓存
    if (this.subtreeCache.has(prefix)) {
      return this.subtreeCache.get(prefix)!;
    }

    const dataUrl = await this.getDataUrl();
    const filename = `trie-${prefix}.json.gz`;

    onProgress?.(0, `加载子树 ${prefix}`);
    const subtree = await this.gzipLoader.load<IJosekiTrieNode>(
      `${dataUrl}/${filename}`,
      `joseki/${filename}`,
      onProgress,
    );
    onProgress?.(100, '子树加载完成');

    // 缓存到内存
    this.subtreeCache.set(prefix, subtree);

    return subtree;
  }

  /**
   * 将子树合并到 trie 中的指定节点
   * @param node - 需要加载子树的节点（有 subtree 字段）
   */
  async loadAndMergeSubtree(node: IJosekiTrieNode, onProgress?: LoadProgressCallback): Promise<void> {
    if (!node.subtree) return;
    if (node.children && Object.keys(node.children).length > 0) return; // 已加载

    const prefix = node.subtree.file.replace('trie-', '').replace('.json.gz', '');
    const subtree = await this.loadSubtree(prefix, onProgress);

    // 合并子树的所有字段
    if (subtree.children) {
      node.children = subtree.children;
    }
    if (subtree.heat !== undefined) {
      node.heat = subtree.heat;
    }
    if (subtree.freq !== undefined) {
      node.freq = subtree.freq;
      if (subtree.prob !== undefined) node.prob = subtree.prob;
      if (subtree.moves !== undefined) node.moves = subtree.moves;
      if (subtree.winrate !== undefined) node.winrate = subtree.winrate;
    }
  }

  /**
   * 加载题库（委托给 JosekiQuizLoader）
   */
  async loadQuizData(
    difficulty: 'easy' | 'medium' | 'hard',
    onProgress?: LoadProgressCallback,
  ): Promise<QuizQuestion[]> {
    return this.quizLoader.loadQuizData(difficulty, onProgress);
  }

  /**
   * 清除缓存
   */
  async clearCache(): Promise<void> {
    this.trie = null;
    this.meta = null;
    this.subtreeCache.clear();
    this.quizLoader.clearCache();

    // 清除本地缓存
    try {
      const files = await this.fileStorage.listFiles('joseki/');
      for (const file of files) {
        await this.fileStorage.delete(file);
      }
    } catch {
      // 忽略删除失败
    }
  }
}
