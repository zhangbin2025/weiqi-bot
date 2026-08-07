/**
 * 定式发现服务（编排层）
 * @description 依赖注入 + 编排，纯逻辑委托给 Domain 层
 */

import type { IJosekiDiscoverService, IDiscoverResult } from './IJosekiDiscoverService';
import type { JosekiLoader } from '../JosekiLoader';
import { discover } from '../../../domain';

export class JosekiDiscoverService implements IJosekiDiscoverService {
  constructor(private readonly loader: JosekiLoader) {}

  async discoverGames(
    sgfList: string[],
    options?: { onProgress?: (percent: number, status: string, detail?: string) => void }
  ): Promise<IDiscoverResult> {
    const onProgress = options?.onProgress;

    // 1. 加载定式库索引
    const trie = await this.loader.loadTrie((percent: number, status: string, detail?: string) => {
      onProgress?.(Math.round(percent * 0.2), `加载定式库: ${status}`, detail);
    });

    // 2. 调用 Domain 层进行定式发现（支持动态加载）
    const patterns = await discover(sgfList, trie, this.loader, {
      firstN: 80,
      minMatchLen: 4,
      exportDepth: 5,
      onProgress: (percent: number, status: string, detail?: string) => {
        onProgress?.(20 + Math.round(percent * 0.8), status, detail);
      },
    });

    return { patterns, total: patterns.length };
  }
}