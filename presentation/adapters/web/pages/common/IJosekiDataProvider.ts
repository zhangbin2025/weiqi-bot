/**
 * 定式数据提供者接口
 * @description 不同 app 实现此接口，将收藏数据转换为定式列表数据
 */
export interface IJosekiDataProvider {
  /** 类别标识，如 'joseki_discover' */
  readonly category: string;
  /**
   * 从收藏数据获取定式列表
   * @param key - 收藏项的 key
   * @returns 定式列表数据
   */
  getJosekiPatterns(key: string): Promise<IJosekiPatternData>;
}
/**
 * 定式列表数据
 */
export interface IJosekiPatternData {
  /** 定式列表 */
  patterns: IJosekiPattern[];
  /** 标题 */
  title?: string;
}
/**
 * 定式数据项
 */
export interface IJosekiPattern {
  id: string;
  prefix: string;
  prefixLen: number;
  totalMoves: number;
  frequency: number;
  probability: number;
  winrateStats?: {
    delta: number;
    stddev?: number;
    samples?: number;
    positive?: number;
    negative?: number;
    neutral?: number;
  };
  extractedMoves?: string;
  gameInfo?: {
    black?: string;
    white?: string;
    date?: string;
    archiveId?: string;
  };
}
