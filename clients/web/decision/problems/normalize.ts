/**
 * 题目数据归一化
 * @description 将原始题目数据归一化为分组结构
 */

export type PhaseStats = { layout: number; middle: number; endgame: number };

export type GameGroup = {
  gameId: string;
  archiveId?: string;
  black?: string;
  white?: string;
  blackRank?: string;
  whiteRank?: string;
  gameName?: string;
  event?: string;
  result?: string;
  date?: string;
  gameLevel?: 'pro' | 'high' | 'normal';
  problemsCount: number;
  phaseStats: PhaseStats;
  problemIndexes: number[];
};

/**
 * 归一化分组数据
 * @description 如果已保存分组则直接使用，否则从题目数据重建分组
 */
export function normalizeGroups(
  problems: any[], 
  data: Record<string, unknown>
): GameGroup[] {
  // 优先使用已保存的分组
  const savedGroups = data['gameGroups'] as GameGroup[] | undefined;
  if (Array.isArray(savedGroups) && savedGroups.length > 0) {
    return savedGroups;
  }

  // 从题目数据重建分组
  const map = new Map<string, GameGroup>();
  
  problems.forEach((problem, index) => {
    const meta = problem.metadata || {};
    // 优先使用 archiveId 或 url 作为唯一标识，meta.gameId 可能是赛事名称（不唯一）
    const gameId = meta.archiveId || meta.url || meta.gameId || `${meta.playerBlack || '黑棋'}-${meta.playerWhite || '白棋'}-${index}`;
    
    let group = map.get(gameId);
    if (!group) {
      group = {
        gameId,
        archiveId: meta.archiveId,
        black: meta.playerBlack,
        white: meta.playerWhite,
        blackRank: meta.blackRank,
        whiteRank: meta.whiteRank,
        gameName: meta.gameName,
        event: meta.event,
        result: meta.result,
        date: meta.date,
        gameLevel: meta.gameLevel,
        problemsCount: 0,
        phaseStats: { layout: 0, middle: 0, endgame: 0 },
        problemIndexes: [],
      };
      map.set(gameId, group);
    }
    
    group.problemsCount++;
    group.problemIndexes.push(index);
    
    const phase = problem.phase as keyof PhaseStats;
    if (phase in group.phaseStats) {
      group.phaseStats[phase]++;
    }
  });
  
  return Array.from(map.values());
}
