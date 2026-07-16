/**
 * 定式发现数据提供者
 * @description 从 joseki_discover 收藏数据转换为定式列表数据
 */
import type { IFavoriteService } from '../../../../../services/favorite';
import type { IJosekiDataProvider, IJosekiPatternData, IJosekiPattern } from './IJosekiDataProvider';
export class JosekiDiscoverProvider implements IJosekiDataProvider {
  readonly category = 'joseki_discover';
  constructor(private readonly favoriteService: IFavoriteService) {}
  async getJosekiPatterns(key: string): Promise<IJosekiPatternData> {
    const item = await this.favoriteService.getFavorite(this.category, key);
    if (!item || !item.data) {
      return { patterns: [] };
    }
    const data = item.data as any;
    const patterns: IJosekiPattern[] = (data.patterns || []).map((p: any, i: number) => ({
      id: p.id || `pattern-${i}`,
      prefix: p.prefix,
      prefixLen: p.prefixLen,
      totalMoves: p.totalMoves,
      frequency: p.frequency,
      probability: p.probability,
      winrateStats: p.winrateStats || (p.winrateDelta ? { delta: p.winrateDelta } : undefined),
      extractedMoves: p.extractedMoves,
      gameInfo: p.gameInfo,
    }));
    return {
      patterns,
      title: data.label,
    };
  }
}
