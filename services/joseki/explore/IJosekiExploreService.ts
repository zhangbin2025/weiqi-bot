/**
 * 定式探索服务接口
 */

import type { IJosekiTrieNode, ICandidateMove } from '../../../domain/joseki';

/**
 * 探索进度回调
 */
export interface ExploreProgressCallback {
  (percent: number, status: string, detail?: string): void;
}

/**
 * 探索统计
 */
export interface IExploreStats {
  movesCount: number;
  winrateDelta: number;
  frequency: number;
  probability: number;
  heat: number;
}

/**
 * 探索结果
 */
export interface IExploreResult {
  path: string[];
  node: IJosekiTrieNode | null;
  candidates: ICandidateMove[];
  stats: IExploreStats;
}

/**
 * 定式探索服务接口
 */
export interface IJosekiExploreService {
  explore(path: string[], onProgress?: ExploreProgressCallback): Promise<IExploreResult>;
  addFavorite(moves: string[]): Promise<void>;
}
