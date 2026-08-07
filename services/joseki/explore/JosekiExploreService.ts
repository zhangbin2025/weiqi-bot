/**
 * 定式探索服务实现
 */

import type { IJosekiExploreService, IExploreResult, ExploreProgressCallback } from './IJosekiExploreService';
import type { JosekiLoader } from '../JosekiLoader';
import type { IConfigProvider } from '../../../infrastructure/config/interfaces/IConfigProvider';
import type { IJosekiExploreConfig } from '../../../infrastructure/config/schemas/JosekiExploreConfigSchema';
import { JosekiExplorer } from '../../../domain/joseki';

/**
 * 定式探索服务
 */
export class JosekiExploreService implements IJosekiExploreService {
  constructor(
    private readonly loader: JosekiLoader,
    private readonly configProvider: IConfigProvider
  ) {}

  async explore(path: string[], onProgress?: ExploreProgressCallback): Promise<IExploreResult> {
    await this.configProvider.getModuleConfig<IJosekiExploreConfig>('josekiExplore');
    const trie = await this.loader.loadTrie((percent, status, detail) => {
      onProgress?.(Math.round(percent * 0.3), `加载定式库: ${status}`, detail);
    });

    onProgress?.(40, '探索路径');
    const explorer = new JosekiExplorer(trie, this.loader);

    for (let i = 0; i < path.length; i++) {
      const coord = path[i];
      await explorer.playMove(coord!);
      const percent = 40 + Math.round((i / path.length) * 30);
      onProgress?.(percent, '探索路径', `${i + 1}/${path.length}: ${coord}`);
    }

    // 检查当前节点是否需要加载子树
    const currentNode = explorer.getCurrentNode();
    if (currentNode.subtree) {
      onProgress?.(75, '加载子树');
      await this.loader.loadAndMergeSubtree(currentNode);
    }

    onProgress?.(100, '完成');

    return {
      path: explorer.getCurrentPath(),
      node: explorer.getCurrentNode(),
      candidates: explorer.getCandidateMoves(),
      stats: explorer.getCurrentStats(),
    };
  }

  /** 添加收藏 */
  async addFavorite(moves: string[]): Promise<void> {
    // TODO: implement favorite storage
  }
}
