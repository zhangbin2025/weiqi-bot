/**
 * 定式列表过滤管理器
 * @description 处理定式标签过滤逻辑
 */
import type { IJosekiPattern } from '../IJosekiDataProvider';
/** 过滤类型 */
export type JosekiFilter = 'all' | 'hot' | 'hit' | 'complex';
/**
 * 过滤管理器
 */
export class JosekiFilterManager {
  private currentFilter: JosekiFilter = 'all';
  /** 计算标签 */
  getPatternTags(pattern: IJosekiPattern): string[] {
    const tags: string[] = [];
    if (pattern.prefixLen >= 8 && pattern.frequency >= 5) tags.push('hot');
    if (pattern.prefixLen >= 8 && pattern.prefixLen >= pattern.totalMoves) tags.push('hit');
    if (pattern.prefixLen >= 12) tags.push('complex');
    return tags;
  }
  /** 设置过滤器 */
  setFilter(filter: JosekiFilter): void {
    this.currentFilter = filter;
  }
  /** 获取当前过滤器 */
  getFilter(): JosekiFilter {
    return this.currentFilter;
  }
  /** 过滤定式 */
  filterPatterns(patterns: IJosekiPattern[]): IJosekiPattern[] {
    return patterns.filter(p => {
      if (this.currentFilter === 'all') return true;
      return this.getPatternTags(p).includes(this.currentFilter);
    });
  }
  /** 计算各标签计数 */
  getCounts(patterns: IJosekiPattern[]): Record<JosekiFilter, number> {
    return {
      all: patterns.length,
      hot: patterns.filter(p => this.getPatternTags(p).includes('hot')).length,
      hit: patterns.filter(p => this.getPatternTags(p).includes('hit')).length,
      complex: patterns.filter(p => this.getPatternTags(p).includes('complex')).length,
    };
  }
}
