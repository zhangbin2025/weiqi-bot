/**
 * 定式发现应用编排器
 * @description 组合 GameService、JosekiDiscoverService、FavoriteService、ThumbnailService 完成定式发现
 */
import type { IGameService } from '../../services/game';
import type { IJosekiDiscoverService } from '../../services/joseki/discover/IJosekiDiscoverService';
import type { IDiscoveredPattern } from '../../services/joseki/discover/types';
import type { IJosekiLoader } from '../../services/joseki/IJosekiLoader';
import type { IFavoriteService } from '../../services/favorite';
import type { ThumbnailMove } from '../../services/thumbnail/types';
import { ThumbnailService } from '../../services/thumbnail/ThumbnailService';
import { SGFParser } from '../../domain/sgf/SGFParser';
import { DiscoverHistoryManager, GameInfo, DiscoverHistoryOptions, DiscoverHistoryEntry, DiscoverStats } from './discover/DiscoverHistoryManager';
/** 发现结果 */
export interface DiscoverResult {
  patterns: IDiscoveredPattern[];
  games: GameInfo[];
  gamesCount: number;
  totalPatterns: number;
  favoriteId?: string | undefined;
  category?: string;
  key?: string;
}
// 导出历史相关类型（保持向后兼容）
export type { GameInfo, DiscoverHistoryOptions, DiscoverHistoryEntry, DiscoverStats };
/** 定式发现应用编排器 */
export class JosekiDiscoverApp {
  private historyManager: DiscoverHistoryManager;
  constructor(
    private readonly gameService?: IGameService,
    private readonly josekiDiscoverService?: IJosekiDiscoverService,
    private readonly josekiLoader?: IJosekiLoader,
    private readonly favoriteService?: IFavoriteService,
    private readonly thumbnailService?: ThumbnailService,
  ) {
    this.historyManager = new DiscoverHistoryManager(favoriteService);
  }
  /** 从线上棋谱发现定式 */
  async discoverFromOnline(
    source: string,
    date?: string,
    limit?: number,
    onProgress?: (percent: number, status: string) => void,
  ): Promise<DiscoverResult> {
    if (!this.gameService) throw new Error('GameService not available');
    if (!this.josekiDiscoverService) throw new Error('JosekiDiscoverService not available');
    onProgress?.(0, '正在获取棋谱列表...');
    const urls = await this.gameService.listPublicGames(date, limit ?? 10);
    onProgress?.(20, `获取到 ${urls.length} 个棋谱，正在下载...`);
    const fetchResults = await this.gameService.fetchMany(urls);
    const sgfList = fetchResults.filter(r => r.success && r.sgfContent).map(r => r.sgfContent!);
    onProgress?.(40, `成功下载 ${sgfList.length} 个棋谱，正在分析...`);
    const discoverResult = await this.josekiDiscoverService.discoverGames(sgfList);
    onProgress?.(90, '正在保存结果...');
    const label = date ? `${source} ${date}` : source;
    // 收集棋谱信息（只存 archiveId，不存 sgf 内容）
    const games: GameInfo[] = fetchResults
      .filter(r => r.success)
      .map(r => ({
        archiveId: r.archiveId,
        black: r.metadata.blackName,
        white: r.metadata.whiteName,
        date: r.metadata.date,
        result: r.metadata.result ?? '',
      }));
    // 为每个 pattern 关联 archiveId
    const patterns = discoverResult.patterns.map(p => {
      const sgfIndex = p.gameInfo?.sgfIndex;
      if (sgfIndex !== undefined && games[sgfIndex]) {
        return {
          ...p,
          gameInfo: {
            ...p.gameInfo,
            archiveId: games[sgfIndex].archiveId,
          },
        };
      }
      return p;
    });
    // 使用收藏服务保存
    const favoriteKey = `${source}_${date || 'all'}`;
    const favoriteId = await this.favoriteService?.addFavorite(
      'joseki_discover',
      favoriteKey,
      {
        label,
        source,
        date,
        gamesCount: sgfList.length,
        patternsFound: discoverResult.total,
        patterns: patterns,
        games,
      },
      label,
    );
    onProgress?.(100, `分析完成，发现 ${discoverResult.total} 个定式`);
    return {
      patterns,
      games,
      gamesCount: sgfList.length,
      totalPatterns: discoverResult.total,
      favoriteId,
      category: 'joseki_discover',
      key: favoriteKey,
    };
  }
  /** 从本地 SGF 内容发现定式 */
  async discoverFromSGF(
    sgfContent: string,
    label: string,
    onProgress?: (percent: number, status: string) => void,
  ): Promise<DiscoverResult> {
    if (!this.josekiDiscoverService) throw new Error('JosekiDiscoverService not available');
    onProgress?.(0, '正在解析 SGF 文件...');
    const discoverResult = await this.josekiDiscoverService.discoverGames([sgfContent]);
    // 解析 SGF 获取游戏信息
    const parsed = new SGFParser().parse(sgfContent);
    const games: GameInfo[] = [{
      archiveId: '',
      black: parsed.gameInfo.black ?? '',
      white: parsed.gameInfo.white ?? '',
      date: parsed.gameInfo.date ?? '',
      result: parsed.gameInfo.result ?? '',
    }];
    onProgress?.(90, '正在保存结果...');
    // 使用收藏服务保存
    const favoriteKey = `local_${Date.now()}`;
    const favoriteId = await this.favoriteService?.addFavorite(
      'joseki_discover',
      favoriteKey,
      {
        label,
        source: 'local',
        gamesCount: 1,
        patternsFound: discoverResult.total,
        patterns: discoverResult.patterns,
        games,
      },
      label,
    );
    onProgress?.(100, `分析完成，发现 ${discoverResult.total} 个定式`);
    return {
      patterns: discoverResult.patterns,
      games,
      gamesCount: 1,
      totalPatterns: discoverResult.total,
      favoriteId,
      category: 'joseki_discover',
      key: favoriteKey,
    };
  }
  /** 构建棋盘状态（用于查看定式详情缩略图） */
  buildBoardState(moves: ThumbnailMove[]) {
    return (this.thumbnailService ?? new ThumbnailService()).buildBoardState(moves);
  }
  // ========== 历史管理（委托给 DiscoverHistoryManager） ==========
  /** 查询发现历史 */
  async queryHistory(options?: DiscoverHistoryOptions): Promise<DiscoverHistoryEntry[]> {
    return this.historyManager.queryHistory(options);
  }
  /** 获取单条历史详情 */
  async getHistoryDetail(id: string): Promise<DiscoverHistoryEntry | null> {
    return this.historyManager.getHistoryDetail(id);
  }
  /** 清除发现历史 */
  async clearHistory(): Promise<void> {
    await this.historyManager.clearHistory();
  }
  /** 获取统计信息 */
  async getStats(): Promise<DiscoverStats> {
    return this.historyManager.getStats();
  }
}
