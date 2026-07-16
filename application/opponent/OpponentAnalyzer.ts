/**
 * 对手分析编排器
 * @description Application 层编排器，组合 GameService、JosekiDiscoverService、ActivityLogService 完成对手分析
 */
import type { IGameService } from '../../services/game';
import type { IJosekiDiscoverService } from '../../services/joseki';
import type { IActivityLogService, ActivityEntry } from '../../services/activity';
import type { IFavoriteService, IFavoriteItem } from '../../services/favorite';
import type { IDiscoveredPattern } from '../../services/joseki/discover/types';
import { parseSGF } from '../../domain/sgf';
/** 游戏信息（对手分析） */
export interface OpponentGameInfo {
  chessid: string;
  archiveId: string;
  black: string;
  white: string;
  date: string;
  result: string;
}
/** 对手分析结果 */
export interface OpponentAnalysisResult {
  foxwqId: string;
  userInfo: { uid: string; nickname: string };
  games: Array<OpponentGameInfo & { sgf?: string | undefined }>;
  joseki: {
    count: number;
    patterns: IDiscoveredPattern[];
  };
  analyzedAt: number;
}
/** 分析选项 */
export interface OpponentAnalyzeOptions {
  maxGames?: number;
  forceRefresh?: boolean;
  onProgress?: (percent: number, status: string, detail?: string) => void;
}
/** 分析历史查询选项 */
export interface OpponentHistoryOptions {
  /** 对手 ID 过滤 */
  foxwqId?: string;
  /** 数量限制 */
  limit?: number;
  /** 偏移量 */
  offset?: number;
}
/** 分析历史条目 */
export interface OpponentHistoryEntry {
  id: string;
  foxwqId: string;
  gamesCount: number;
  patternsFound: number;
  games: OpponentGameInfo[];
  joseki: OpponentAnalysisResult['joseki'];
  analyzedAt: number;
}
/** 对手收藏条目 */
export interface OpponentBookmark {
  id: string;
  foxwqId: string;
  games: OpponentGameInfo[] | undefined;
  joseki: OpponentAnalysisResult['joseki'] | undefined;
  statistics: {
    totalGames: number;
    uniqueOpponents: number;
    topOpponent: string;
    topOpponentCount: number;
    firstDate: string;
    lastDate: string;
    winCount: number;
    loseCount: number;
    winRate: number;
  } | undefined;
  analyzedAt: number | undefined;
  updatedAt: number;
}
/** 分析结果（带收藏 ID） */
export interface OpponentAnalysisResultWithBookmark extends OpponentAnalysisResult {
  bookmarkId?: string;
}
/**
 * 对手分析编排器
 * @description 组合 GameService、JosekiDiscoverService、ActivityLogService 完成对手分析
 */
export class OpponentAnalyzer {
  constructor(
    private readonly gameService: IGameService,
    private readonly josekiDiscoverService: IJosekiDiscoverService,
    private readonly activityLogService?: IActivityLogService,
    private readonly favoriteService?: IFavoriteService,
  ) {}
  async analyze(
    foxwqId: string,
    options?: OpponentAnalyzeOptions
  ): Promise<OpponentAnalysisResultWithBookmark> {
    const onProgress = options?.onProgress;
    const maxGames = options?.maxGames ?? 10;
    // 1. 获取棋手棋谱 ID 列表
    onProgress?.(0, '开始分析', foxwqId);
    onProgress?.(10, '获取棋谱列表');
    const gameIds = await this.gameService.listPlayerGames(foxwqId, maxGames);
    if (gameIds.length === 0) {
      onProgress?.(100, '无棋谱数据');
      return {
        foxwqId, userInfo: { uid: foxwqId, nickname: foxwqId },
        games: [], joseki: { count: 0, patterns: [] }, analyzedAt: Date.now(),
      };
    }
    onProgress?.(15, `获取到 ${gameIds.length} 盘棋谱`);
    // 2. 通过 chessid 批量下载棋谱
    const fetchResults = await this.gameService.fetchByChessIds(gameIds, {
      onProgress: (current, total, chessid) => {
        const percent = 15 + Math.round((current / total) * 55);
        onProgress?.(percent, '下载棋谱', `${current}/${total}: ${chessid}`);
      },
    });
    console.log('[OpponentAnalyzer] fetchResults:', fetchResults.map(r => ({
      chessid: r.metadata.gameId,
      archiveId: r.archiveId,
      success: r.success,
      hasSgf: !!r.sgfContent,
    })));
    // 3. 提取 SGF 内容
    onProgress?.(75, '提取 SGF 内容');
    const sgfList = fetchResults
      .filter(r => r.success && r.sgfContent)
      .map(r => r.sgfContent!);
    // 4. 定式分析
    const josekiResult = { count: 0, patterns: [] as IDiscoveredPattern[] };
    if (sgfList.length > 0) {
      onProgress?.(80, '分析定式', `${sgfList.length} 盘棋谱`);
      const discoverResult = await this.josekiDiscoverService.discoverGames(sgfList, {
        onProgress: (percent, status, detail) => {
          const mappedPercent = 80 + Math.round(percent * 0.15);
          onProgress?.(mappedPercent, status, detail);
        },
      });
      josekiResult.count = discoverResult.total;
      josekiResult.patterns = discoverResult.patterns;
      // 为每个 pattern 填充 archiveId（根据 sgfIndex 从 fetchResults 中查找）
      josekiResult.patterns.forEach(pattern => {
        if (pattern.gameInfo?.sgfIndex !== undefined) {
          const sgfIndex = pattern.gameInfo.sgfIndex;
          const fetchResult = fetchResults.filter(r => r.success)[sgfIndex];
          if (fetchResult) {
            pattern.gameInfo = {
              ...pattern.gameInfo,
              archiveId: fetchResult.archiveId,
            };
          }
        }
      });
    } else {
      onProgress?.(100, '无有效棋谱');
      return {
        foxwqId, userInfo: { uid: foxwqId, nickname: foxwqId },
        games: [], joseki: { count: 0, patterns: [] }, analyzedAt: Date.now(),
      };
    }
    // 5. 构造结果（从 SGF 提取元数据）
    const result: OpponentAnalysisResult = {
      foxwqId,
      userInfo: { uid: foxwqId, nickname: foxwqId },
      games: fetchResults
        .filter(r => r.success)
        .map(r => {
          // 从 SGF 内容中提取元数据
          let black = r.metadata.blackName;
          let white = r.metadata.whiteName;
          let date = r.metadata.date;
          let resultStr = r.metadata.result ?? '';
          // 如果 metadata 为空，尝试从 SGF 中提取
          if (r.sgfContent && (!black || !white)) {
            try {
              const parsed = parseSGF(r.sgfContent);
              if (parsed.gameInfo) {
                black = black || parsed.gameInfo.black || '';
                white = white || parsed.gameInfo.white || '';
                date = date || parsed.gameInfo.date || '';
                // 从 SGF 中提取结果
                if (parsed.gameInfo.result) {
                  resultStr = resultStr || parsed.gameInfo.result;
                }
              }
            } catch (e) {
              // 解析失败，保持原值
            }
          }
          const game: OpponentGameInfo & { sgf?: string | undefined } = {
            chessid: r.metadata.gameId,
            archiveId: r.archiveId,
            black,
            white,
            date,
            result: resultStr,
          };
          if (r.sgfContent) game.sgf = r.sgfContent;
          return game;
        }),
      joseki: josekiResult,
      analyzedAt: Date.now(),
    };
    // 6. 记录活动日志（保存完整数据）
    await this.activityLogService?.record(
      'joseki_discover',
      `分析对手：${foxwqId}`,
      {
        foxwqId,
        gamesCount: result.games.length,
        patternsFound: result.joseki.count,
        games: result.games.map(g => ({
          chessid: g.chessid,
          archiveId: g.archiveId,
          black: g.black,
          white: g.white,
          date: g.date,
          result: g.result,
        })),
        joseki: result.joseki,
      },
      [foxwqId, '对手分析']
    );
    // 7. 计算统计数据
    const statistics = this.calculateStatistics(result.games, foxwqId);
    // 8. 收藏对手（有棋谱数据时才收藏）
    const bookmarkId = result.games.length > 0 && this.favoriteService
      ? await this.favoriteService.addFavorite('opponent', foxwqId, { 
          foxwqId, 
          games: result.games.map(g => ({
            chessid: g.chessid,
            archiveId: g.archiveId,
            black: g.black,
            white: g.white,
            date: g.date,
            result: g.result,
          })),
          joseki: result.joseki,
          statistics,
          analyzedAt: result.analyzedAt,
        })
      : undefined;
    // 完成
    onProgress?.(100, '分析完成', `发现 ${josekiResult.count} 个定式`);
    return { ...result, ...(bookmarkId ? { bookmarkId } : {}) };
  }
  /**
   * 计算统计数据
   */
  private calculateStatistics(games: Array<OpponentGameInfo & { sgf?: string | undefined }>, foxwqId: string) {
    // 计算对手统计
    const opponents = new Set<string>();
    const opponentCounts: Record<string, number> = {};
    games.forEach(game => {
      // 从黑白双方推断对手
      const isBlack = game.black.includes(foxwqId);
      const opponent = isBlack ? game.white : game.black;
      if (opponent && opponent !== foxwqId) {
        opponents.add(opponent);
        opponentCounts[opponent] = (opponentCounts[opponent] || 0) + 1;
      }
    });
    // 找出活跃对手
    let topOpponent = '-';
    let maxCount = 0;
    for (const [opponent, count] of Object.entries(opponentCounts)) {
      if (count > maxCount) {
        maxCount = count;
        topOpponent = opponent;
      }
    }
    // 计算时间范围
    let firstDate: string | null = null;
    let lastDate: string | null = null;
    games.forEach(game => {
      if (game.date) {
        if (!firstDate || firstDate > game.date) firstDate = game.date;
        if (!lastDate || lastDate < game.date) lastDate = game.date;
      }
    });
    // 计算胜负统计
    let winCount = 0;
    let loseCount = 0;
    games.forEach(game => {
      if (game.result) {
        const isWin = game.result.includes('黑胜') && game.black.includes(foxwqId) ||
                      game.result.includes('白胜') && game.white.includes(foxwqId);
        if (isWin) winCount++;
        else loseCount++;
      }
    });
    return {
      totalGames: games.length,
      uniqueOpponents: opponents.size,
      topOpponent,
      topOpponentCount: maxCount,
      firstDate: firstDate || '-',
      lastDate: lastDate || '-',
      winCount,
      loseCount,
      winRate: games.length > 0 ? Math.round((winCount / games.length) * 100) : 0,
    };
  }
  /**
   * 获取对手收藏列表
   */
  async getFavorites(): Promise<OpponentBookmark[]> {
    if (!this.favoriteService) return [];
    const items = await this.favoriteService.getFavorites({ category: 'opponent' });
    return items.map((item: IFavoriteItem) => {
      // 兼容旧数据格式
      if (item.data?.['result'] && !item.data?.['games']) {
        const result = item.data['result'] as OpponentAnalysisResult;
        return {
          id: item.id,
          foxwqId: item.key,  // 统一使用 favoriteService 的 key
          games: result.games,
          joseki: result.joseki,
          statistics: undefined,
          analyzedAt: result.analyzedAt,
          updatedAt: item.createdAt,
        };
      }
      // 新数据格式
      return {
        id: item.id,
        foxwqId: (item.data?.['foxwqId'] as string) ?? item.key,
        games: item.data?.['games'] as OpponentGameInfo[] | undefined,
        joseki: item.data?.['joseki'] as OpponentAnalysisResult['joseki'] | undefined,
        statistics: item.data?.['statistics'] as ReturnType<typeof this.calculateStatistics> | undefined,
        analyzedAt: item.data?.['analyzedAt'] as number | undefined,
        updatedAt: item.createdAt,
      };
    });
  }
  /**
   * 清空对手收藏
   */
  async clearFavorites(): Promise<void> {
    await this.favoriteService?.clear('opponent');
  }
  /**
   * 查询对手分析历史
   */
  async queryHistory(options?: OpponentHistoryOptions): Promise<OpponentHistoryEntry[]> {
    if (!this.activityLogService) return [];
    const entries = await this.activityLogService.query({
      type: 'joseki_discover',
      keyword: options?.foxwqId,
      limit: options?.limit ?? 20,
      offset: options?.offset,
    });
    return entries.map((entry: ActivityEntry) => ({
      id: entry.id,
      foxwqId: (entry.data['foxwqId'] as string) ?? '',
      gamesCount: (entry.data['gamesCount'] as number) ?? 0,
      patternsFound: (entry.data['patternsFound'] as number) ?? 0,
      games: (entry.data['games'] as OpponentGameInfo[]) ?? [],
      joseki: (entry.data['joseki'] as OpponentAnalysisResult['joseki']) ?? { count: 0, patterns: [] },
      analyzedAt: entry.createdAt,
    }));
  }
  /**
   * 获取指定对手的分析详情（从活动日志恢复）
   */
  async getHistoryDetail(id: string): Promise<OpponentAnalysisResult | null> {
    if (!this.activityLogService) return null;
    const entry = await this.activityLogService.getById(id);
    if (!entry) return null;
    const result = entry.data as unknown as OpponentAnalysisResult;
    // 从 archiveId 恢复 SGF 内容
    if (result.games?.length) {
      for (const game of result.games) {
        if (game.archiveId && !game.sgf) {
          game.sgf = await this.gameService.getByArchiveId(game.archiveId) ?? undefined;
        }
      }
    }
    return result;
  }
}
