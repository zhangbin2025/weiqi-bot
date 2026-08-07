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

  /** 从线上棋谱发现定式（按日期倒序取最近 limit 盘） */
  async discoverFromOnline(
    source: string,
    limit?: number,
    onProgress?: (percent: number, status: string) => void,
  ): Promise<DiscoverResult> {
    if (!this.gameService) throw new Error('GameService not available');
    if (!this.josekiDiscoverService) throw new Error('JosekiDiscoverService not available');
    onProgress?.(0, '正在获取棋谱列表...');

    let sgfList: string[];
    let games: GameInfo[];

    if (source === 'katago') {
      // KataGo 数据流：直接从 tar.bz2 解压得到 SGF
      const result = await this.discoverFromKatago(limit ?? 10, onProgress);
      sgfList = result.sgfList;
      games = result.games;
    } else {
      // 野狐等传统数据流：URL 列表 → 逐个下载
      const result = await this.discoverFromFoxwq(limit ?? 10, onProgress);
      sgfList = result.sgfList;
      games = result.games;
    }

    onProgress?.(40, `成功获取 ${sgfList.length} 个棋谱，正在分析...`);
    const discoverResult = await this.josekiDiscoverService.discoverGames(sgfList);
    onProgress?.(90, '正在保存结果...');

    const labelMap: Record<string, string> = { foxwq: '野狐棋谱', katago: 'KataGo棋谱' };
    const label = labelMap[source] || source;

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
    const favoriteKey = `${source}_${new Date().toISOString().slice(0, 10)}`;
    const favoriteId = await this.favoriteService?.addFavorite(
      'joseki_discover',
      favoriteKey,
      {
        label,
        source,
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

  /** 野狐数据流：获取最新棋谱（按日期倒序，不传日期过滤） */
  private async discoverFromFoxwq(
    limit: number,
    onProgress?: (percent: number, status: string) => void,
  ): Promise<{ sgfList: string[]; games: GameInfo[] }> {
    const urls = await this.gameService!.listPublicGames(undefined, limit);
    onProgress?.(20, `获取到 ${urls.length} 个棋谱，正在下载...`);
    const fetchResults = await this.gameService!.fetchMany(urls);
    const sgfList = fetchResults.filter(r => r.success && r.sgfContent).map(r => r.sgfContent!);
    const games: GameInfo[] = fetchResults
      .filter(r => r.success)
      .map(r => ({
        archiveId: r.archiveId,
        black: r.metadata.blackName,
        white: r.metadata.whiteName,
        date: r.metadata.date,
        result: r.metadata.result ?? '',
      }));
    return { sgfList, games };
  }

  /** KataGo 数据流：从最新日期开始，逐日抓取，直到凑够 limit 盘 */
  private async discoverFromKatago(
    limit: number,
    onProgress?: (percent: number, status: string) => void,
  ): Promise<{ sgfList: string[]; games: GameInfo[] }> {
    const allSgfList: string[] = [];
    const allGames: GameInfo[] = [];
    let remaining = limit;

    // 从最新日期开始，逐日抓取，直到凑够 limit 盘
    const dates = await this.gameService!.listKatagoArchiveDates();
    for (const entry of dates) {
      if (remaining <= 0) break;

      onProgress?.(20, `正在下载 ${entry.date} 的棋谱...`);
      const sgfEntries = await this.gameService!.fetchKatagoGames(entry.date, remaining);

      for (const sgf of sgfEntries) {
        if (remaining <= 0) break;
        allSgfList.push(sgf.sgfContent);
        const parsed = new SGFParser().parse(sgf.sgfContent);
        // 通过 archive provider 归档 SGF，获取真实 archiveId
        const archiveUrl = this.buildArchiveUrl(sgf.sgfContent, parsed.gameInfo.black, parsed.gameInfo.white);
        const archiveResult = await this.gameService!.fetch(archiveUrl);
        allGames.push({
          archiveId: archiveResult.archiveId,
          black: parsed.gameInfo.black ?? '',
          white: parsed.gameInfo.white ?? '',
          date: parsed.gameInfo.date ?? entry.date,
          result: parsed.gameInfo.result ?? '',
        });
        remaining--;
      }
    }

    return { sgfList: allSgfList, games: allGames };
  }

  /** 构建 archive provider URL */
  private buildArchiveUrl(sgfContent: string, black?: string, white?: string): string {
    const encoded = btoa(unescape(encodeURIComponent(sgfContent)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const params = new URLSearchParams();
    if (black) params.set('black', black);
    if (white) params.set('white', white);
    return `archive:${encoded}?${params.toString()}`;
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
