/**
 * 定式发现服务接口
 */

import type { IDiscoveredPattern } from './types';

/**
 * 发现结果
 */
export interface IDiscoverResult {
  patterns: IDiscoveredPattern[];
  total: number;
}

/**
 * 定式发现服务接口
 */
export interface IJosekiDiscoverService {
  /** 从多盘棋谱中发现定式规律 */
  discoverGames(
    sgfList: string[],
    options?: { onProgress?: (percent: number, status: string, detail?: string) => void }
  ): Promise<IDiscoverResult>;
}
