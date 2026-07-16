/**
 * 决策题应用编排器
 * @description Application 层编排器，组合 GameService、DecisionService、FavoriteService 完成决策题生成
 */
import type { IGameService } from '../../services/game';
import type { IDecisionService } from '../../services/decision';
import type { IFavoriteService } from '../../services/favorite';
import type { IDecisionProblem, DecisionDifficulty, DecisionPhase, GameLevel } from '../../domain/decision';
import type { GameServiceResult } from '../../services/game';
/** 决策题生成选项 */
export interface DecisionGenerateOptions {
  /** 题目难度 */
  difficulty?: DecisionDifficulty | undefined;
  /** 阶段筛选 */
  phase?: DecisionPhase | undefined;
  /** 恶手题优先 */
  blunderFirst?: boolean | undefined;
}
/** 决策题生成结果 */
export interface DecisionGenerateStats {
  phases: Record<DecisionPhase, number>;
  levels: Record<GameLevel, number>;
}
export interface DecisionGameGroup {
  gameId: string;
  archiveId?: string | undefined;
  url?: string | undefined;
  black?: string | undefined;
  white?: string | undefined;
  blackRank?: string | undefined;
  whiteRank?: string | undefined;
  gameName?: string | undefined;
  event?: string | undefined;
  result?: string | undefined;
  date?: string | undefined;
  gameLevel: GameLevel;
  problemsCount: number;
  phaseStats: Record<DecisionPhase, number>;
  problemIndexes: number[];
}
/** 决策题生成结果 */
export interface DecisionGenerateResult {
  /** 下载成功的棋谱数 */
  gamesCount: number;
  /** 有恶手题的棋谱数 */
  quizGamesCount: number;
  /** 生成的题目 */
  problems: IDecisionProblem[];
  /** 按棋谱分组 */
  gameGroups: DecisionGameGroup[];
  /** 统计 */
  stats: DecisionGenerateStats;
  /** 生成时间 */
  generatedAt: number;
  /** 收藏ID */
  favoriteId?: string | undefined;
  /** 分类 */
  category?: string;
  /** 键 */
  key?: string;
}
/** 历史查询选项 */
export interface DecisionHistoryOptions {
  /** 关键词过滤 */
  keyword?: string;
  /** 数量限制 */
  limit?: number;
  /** 偏移量 */
  offset?: number;
}
/** 历史条目 */
export interface DecisionHistoryEntry {
  id: string;
  label: string;
  gamesCount: number;
  problemsCount: number;
  generatedAt: number;
}
/**
 * 决策题应用编排器
 * @description 组合 GameService、DecisionService、FavoriteService 完成决策题生成
 */
export class DecisionApp {
  constructor(
    private readonly gameService?: IGameService,
    private readonly decisionService?: IDecisionService,
    private readonly favoriteService?: IFavoriteService,
  ) {}
  /** 从线上公开棋谱生成决策题（带选项和进度回调） */
  async generateFromOnlineWithOptions(
    date?: string,
    limit?: number,
    options?: DecisionGenerateOptions,
    onProgress?: (percent: number, status: string) => void,
  ): Promise<DecisionGenerateResult> {
    if (!this.gameService) throw new Error('GameService not available');
    if (!this.decisionService) throw new Error('DecisionService not available');
    // 1. 获取公开棋谱列表
    onProgress?.(0, '正在获取棋谱列表...');
    const urls = await this.gameService.listPublicGames(date, limit ?? 10);
    onProgress?.(10, `获取到 ${urls.length} 个棋谱`);
    // 2. 批量下载棋谱
    onProgress?.(20, `正在下载棋谱...`);
    const fetchResults = await this.gameService.fetchMany(urls);
    // 3. 提取 SGF 内容
    const successfulResults = fetchResults.filter((r): r is GameServiceResult & { sgfContent: string } => Boolean(r.success && r.sgfContent));
    onProgress?.(40, `成功下载 ${successfulResults.length} 个棋谱，正在分析...`);
    // 4. 逐个生成决策题（只生成恶手题）
    const allProblems: IDecisionProblem[] = [];
    const gameGroups: DecisionGameGroup[] = [];
    for (let i = 0; i < successfulResults.length; i++) {
      const fetchResult = successfulResults[i]!;
      const result = await this.decisionService.generateFromSGF(fetchResult.sgfContent, {
        difficulty: options?.difficulty,
        phase: options?.phase,
        blunderFirst: options?.blunderFirst,
        blunderOnly: true,
        archiveId: fetchResult.archiveId,
        url: fetchResult.url,
      });
      const startIndex = allProblems.length;
      allProblems.push(...result.problems);
      const group = this.buildGameGroup(result.problems, startIndex, fetchResult);
      if (group) gameGroups.push(group);
      // 更新进度（40-90之间）
      const percent = 40 + Math.round(((i + 1) / Math.max(successfulResults.length, 1)) * 50);
      onProgress?.(percent, `已分析 ${i + 1}/${successfulResults.length} 个棋谱，生成 ${allProblems.length} 道恶手题`);
    }
    const stats = this.buildStats(allProblems);
    // 5. 保存到favorite
    onProgress?.(90, '正在保存结果...');
    const label = (date || new Date().toISOString().split('T')[0]) as string;
    const favoriteKey = `foxwq_${date || 'all'}`;
    const favoriteData = {
      label,
      source: 'foxwq',
      date,
      gamesCount: successfulResults.length,
      quizGamesCount: gameGroups.length,
      problemsCount: allProblems.length,
      stats,
      gameGroups,
      problems: allProblems,
    };
    const favoriteId = await this.favoriteService?.addFavorite(
      'decision_generate',
      favoriteKey,
      favoriteData,
      label
    );
    onProgress?.(100, `分析完成，${successfulResults.length} 份棋谱生成 ${allProblems.length} 道恶手题`);
    return {
      gamesCount: successfulResults.length,
      quizGamesCount: gameGroups.length,
      problems: allProblems,
      gameGroups,
      stats,
      generatedAt: Date.now(),
      favoriteId,
      category: 'decision_generate',
      key: favoriteKey,
    };
  }
  private buildStats(problems: IDecisionProblem[]): DecisionGenerateStats {
    const stats: DecisionGenerateStats = {
      phases: { layout: 0, middle: 0, endgame: 0 },
      levels: { pro: 0, high: 0, normal: 0 },
    };
    for (const problem of problems) {
      stats.phases[problem.phase]++;
      stats.levels[problem.metadata.gameLevel]++;
    }
    return stats;
  }
  private buildGameGroup(
    problems: IDecisionProblem[],
    startIndex: number,
    fetchResult: GameServiceResult,
  ): DecisionGameGroup | null {
    if (problems.length === 0) return null;
    const first = problems[0]!;
    const meta = first.metadata;
    const phaseStats: Record<DecisionPhase, number> = { layout: 0, middle: 0, endgame: 0 };
    const problemIndexes: number[] = [];
    problems.forEach((problem, offset) => {
      phaseStats[problem.phase]++;
      problemIndexes.push(startIndex + offset);
    });
    return {
      // 优先使用 archiveId 或 url 作为唯一标识，meta.gameId 可能是赛事名称（不唯一）
      gameId: fetchResult.archiveId || fetchResult.url || meta.gameId || `game-${startIndex}`,
      archiveId: meta.archiveId || fetchResult.archiveId,
      url: meta.url || fetchResult.url,
      black: meta.playerBlack,
      white: meta.playerWhite,
      blackRank: meta.blackRank,
      whiteRank: meta.whiteRank,
      gameName: meta.gameName,
      event: meta.event,
      result: meta.result,
      date: meta.date,
      gameLevel: meta.gameLevel,
      problemsCount: problems.length,
      phaseStats,
      problemIndexes,
    };
  }
  /** 查询决策题生成历史 */
  async queryHistory(options?: DecisionHistoryOptions): Promise<DecisionHistoryEntry[]> {
    if (!this.favoriteService) return [];
    const favorites = await this.favoriteService.getFavorites({
      category: 'decision_generate',
    });
    return favorites.map(fav => ({
      id: fav.id,
      label: (fav.data?.['label'] as string) ?? '',
      gamesCount: (fav.data?.['gamesCount'] as number) ?? 0,
      problemsCount: (fav.data?.['problemsCount'] as number) ?? 0,
      generatedAt: fav.createdAt,
    }));
  }
  /** 获取指定历史详情 */
  async getHistoryDetail(id: string): Promise<DecisionGenerateResult | null> {
    if (!this.favoriteService) return null;
    const fav = await this.favoriteService.getById(id);
    if (!fav) return null;
    const problems = (fav.data?.['problems'] as IDecisionProblem[]) ?? [];
    return {
      gamesCount: (fav.data?.['gamesCount'] as number) ?? 0,
      quizGamesCount: (fav.data?.['quizGamesCount'] as number) ?? 0,
      problems,
      gameGroups: (fav.data?.['gameGroups'] as DecisionGameGroup[]) ?? [],
      stats: (fav.data?.['stats'] as DecisionGenerateStats) ?? this.buildStats(problems),
      generatedAt: fav.createdAt,
      favoriteId: fav.id,
      category: fav.category,
      key: fav.key,
    };
  }
  /** 清空决策题生成历史 */
  async clearHistory(): Promise<void> {
    await this.favoriteService?.clear('decision_generate');
  }
}
