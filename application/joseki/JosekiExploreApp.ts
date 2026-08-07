/**
 * 定式探索应用编排器
 * @description 组合 JosekiExploreService、FavoriteService、ThumbnailService 完成定式探索与收藏管理
 */
import type { IJosekiExploreService, IExploreResult } from '../../services/joseki/explore/IJosekiExploreService';
import type { IFavoriteService } from '../../services/favorite/IFavoriteService';
import type { IJosekiLoader } from '../../services/joseki/IJosekiLoader';
import type { ThumbnailMove } from '../../services/thumbnail/types';
import { ThumbnailService } from '../../services/thumbnail/ThumbnailService';
import { ExploreFavoritesManager, FavoriteQueryOptions, FavoriteEntry, FavoriteStats } from './explore/ExploreFavoritesManager';
/** 探索进度回调 */
export interface ExploreProgressCallback {
  (percent: number, status: string, detail?: string): void;
}
/** 探索结果 */
export interface ExploreResult {
  /** 当前路径 */
  path: string[];
  /** 当前节点统计 */
  stats: {
    moves: number;
    freq: number;
    prob: number;
    winrate?: {
      delta: number;
      stddev?: number;
      samples?: number;
      positive?: number;
      negative?: number;
      neutral?: number;
    };
  };
  /** 候选着法（按热度排序） */
  candidates: Array<{
    coord: string;
    heat: number;
    color: 'black' | 'white';
  }>;
}
// 导出收藏相关类型（保持向后兼容）
export type { FavoriteQueryOptions, FavoriteEntry, FavoriteStats };
/**
 * 定式探索应用编排器
 */
export class JosekiExploreApp {
  private trieLoaded = false;
  private favoritesManager: ExploreFavoritesManager;
  constructor(
    private readonly josekiExploreService?: IJosekiExploreService,
    private readonly josekiLoader?: IJosekiLoader,
    favoriteService?: IFavoriteService,
    private readonly thumbnailService?: ThumbnailService,
  ) {
    this.favoritesManager = new ExploreFavoritesManager(favoriteService);
  }
  /** 初始化（加载定式库） */
  async initialize(onProgress?: ExploreProgressCallback): Promise<void> {
    if (this.trieLoaded) {
      onProgress?.(100, '已加载');
      return;
    }
    if (!this.josekiLoader) {
      throw new Error('JosekiLoader not available');
    }
    onProgress?.(0, '开始加载定式库');
    await this.josekiLoader.loadTrie((percent, status, detail) => {
      onProgress?.(percent, status, detail);
    });
    this.trieLoaded = true;
    onProgress?.(100, '加载完成');
  }
  /** 探索定式路径 */
  async explore(path: string[], onProgress?: ExploreProgressCallback): Promise<ExploreResult> {
    if (!this.josekiExploreService) throw new Error('JosekiExploreService not available');
    // 注意：trie 加载由 JosekiExploreService.explore 内部处理
    const result = await this.josekiExploreService.explore(path, onProgress);
    // 标记为已加载（下次可跳过）
    this.trieLoaded = true;
    return this.transformExploreResult(result);
  }
  /** 构建棋盘状态 */
  buildBoardState(moves: ThumbnailMove[]) {
    return (this.thumbnailService ?? new ThumbnailService()).buildBoardState(moves);
  }
  // ========== 收藏管理（委托给 ExploreFavoritesManager） ==========
  /** 收藏定式 */
  async addFavorite(path: string[], note?: string): Promise<string> {
    return this.favoritesManager.addFavorite(path, note);
  }
  /** 查询收藏列表 */
  async queryFavorites(options?: FavoriteQueryOptions): Promise<FavoriteEntry[]> {
    return this.favoritesManager.queryFavorites(options);
  }
  /** 删除收藏 */
  async removeFavorite(id: string): Promise<void> {
    await this.favoritesManager.removeFavorite(id);
  }
  /** 导出收藏 */
  async exportFavorites(): Promise<string> {
    return this.favoritesManager.exportFavorites();
  }
  /** 导入收藏 */
  async importFavorites(json: string): Promise<number> {
    return this.favoritesManager.importFavorites(json);
  }
  /** 清空收藏 */
  async clearFavorites(): Promise<void> {
    await this.favoritesManager.clearFavorites();
  }
  /** 收藏统计 */
  async getFavoriteStats(): Promise<FavoriteStats> {
    return this.favoritesManager.getFavoriteStats();
  }
  /** 转换探索结果 */
  private transformExploreResult(result: IExploreResult): ExploreResult {
    const candidates = result.candidates
      .map(c => ({
        coord: c.coord,
        heat: c.stats.heat,
        color: c.color ?? (result.path.length % 2 === 0 ? 'black' as const : 'white' as const),
      }))
      .sort((a, b) => b.heat - a.heat);
    // 从 node 中获取完整的 winrate 数据
    const winrate = result.node?.winrate;
    const stats: ExploreResult['stats'] = {
      moves: result.stats.movesCount,
      freq: result.candidates.reduce((sum, c) => sum + c.stats.frequency, 0),
      prob: result.candidates.reduce((sum, c) => sum + c.stats.probability, 0),
    };
    if (winrate) {
      stats.winrate = {
        delta: winrate.delta,
        ...(winrate.stddev !== undefined && { stddev: winrate.stddev }),
        ...(winrate.samples !== undefined && { samples: winrate.samples }),
        ...(winrate.positive !== undefined && { positive: winrate.positive }),
        ...(winrate.negative !== undefined && { negative: winrate.negative }),
        ...(winrate.neutral !== undefined && { neutral: winrate.neutral }),
      };
    }
    return {
      path: result.path,
      stats,
      candidates,
    };
  }
}
