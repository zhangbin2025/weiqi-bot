/**
 * 对手分析的定式列表提供者
 * @description 从 opponent 收藏数据获取定式列表
 */
import type { IFavoriteService } from '../../../../../services/favorite';
import type { IJosekiDataProvider, IJosekiPatternData, IJosekiPattern } from './IJosekiDataProvider';
export class OpponentJosekiListProvider implements IJosekiDataProvider {
  readonly category = 'opponent';
  constructor(private readonly favoriteService: IFavoriteService) {}
  async getJosekiPatterns(key: string): Promise<IJosekiPatternData> {
    const item = await this.favoriteService.getFavorite('opponent', key);
    if (!item || !item.data || !item.data['joseki']) {
      return { patterns: [] };
    }
    const joseki = item.data['joseki'] as {
      count: number;
      patterns: Array<{
        id?: string;
        prefix: string;
        prefixLen?: number;
        totalMoves?: number;
        frequency: number;
        probability?: number;
        winrateDelta?: number;
        extractedMoves?: string;
        gameInfo?: {
          black?: string;
          white?: string;
          date?: string;
          archiveId?: string;
        };
        sourceCorner?: string;
      }>;
    };
    const patterns: IJosekiPattern[] = (joseki.patterns || []).map((p, i) => ({
      id: p.id || `pattern-${i}`,
      prefix: p.prefix,
      prefixLen: p.prefixLen ?? p.prefix.split(/\s+/).length,
      totalMoves: p.totalMoves ?? 0,
      frequency: p.frequency,
      probability: p.probability ?? 0,
      ...(p.winrateDelta ? { winrateStats: { delta: p.winrateDelta } } : {}),
      ...(p.extractedMoves ? { extractedMoves: p.extractedMoves } : {}),
      ...(p.gameInfo ? { gameInfo: p.gameInfo } : {}),
    }));
    return {
      patterns,
      title: `${key} 的定式`,
    };
  }
}
