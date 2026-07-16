/**
 * 定式加载器接口
 * @description 定义加载器接口和元数据结构
 */

import type { IJosekiTrie, IJosekiTrieNode } from '../../domain/joseki';

/**
 * 元数据（对应 trie-meta.json）
 */
export interface IJosekiMeta {
  /** 版本 */
  version: string;
  /** 裁剪阈值 */
  threshold: number;
  /** 总定式数 */
  total: number;
  /** 子树数量 */
  subtrees: number;
  /** 难度统计 */
  difficulty: {
    easy: number;
    medium: number;
    hard: number;
  };
  /** 索引大小 */
  indexSize: number;
}

/**
 * 加载进度回调
 */
export interface LoadProgressCallback {
  (percent: number, status: string, detail?: string): void;
}

/**
 * 定式加载器接口
 */
export interface IJosekiLoader {
  /** 加载索引 */
  loadTrie(onProgress?: LoadProgressCallback): Promise<IJosekiTrie>;
  /** 加载元数据 */
  loadMeta(): Promise<IJosekiMeta>;
  /** 按需加载子树 */
  loadSubtree(prefix: string, onProgress?: LoadProgressCallback): Promise<IJosekiTrieNode>;
  /** 加载并合并子树到节点 */
  loadAndMergeSubtree(node: IJosekiTrieNode, onProgress?: LoadProgressCallback): Promise<void>;
  /** 加载题库 */
  loadQuizData(
    difficulty: 'easy' | 'medium' | 'hard',
    onProgress?: LoadProgressCallback
  ): Promise<QuizQuestion[]>;
  /** 清除缓存 */
  clearCache(): Promise<void>;
}

/**
 * 做题数据结构（对应 quiz-{difficulty}.json.gz 的 leaves 项）
 */
export interface QuizQuestion {
  /** 路径（前缀） */
  path: string;
  /** 手数 */
  moves: number;
  /** 频率 */
  freq: number;
  /** 概率 */
  prob: number;
  /** 胜率统计 */
  winrate?: {
    delta: number;
    stddev?: number;
    samples?: number;
    positive?: number;
    negative?: number;
    neutral?: number;
  };
}
