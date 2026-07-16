/**
 * 发现的定式模式
 */
export interface IDiscoveredPattern {
  /** 路径前缀 */
  prefix: string;
  /** 频率 */
  frequency: number;
  /** 胜率变化 */
  winrateDelta?: number;
  /** 完整的胜率统计 */
  winrateStats?: {
    delta: number;
    stddev?: number;
    samples?: number;
    positive?: number;
    negative?: number;
    neutral?: number;
  };

  /** 匹配长度 */
  prefixLen: number;
  /** 总手数 */
  totalMoves: number;
  /** 来源角 tl/tr/bl/br */
  sourceCorner: string;
  /** 概率 */
  probability: number;
  /** 导出的定式树 SGF */
  extractedMoves?: string;
  /** 来源棋谱信息 */
  gameInfo?: {
    black?: string;
    white?: string;
    date?: string;
    /** 来源棋谱索引 */
    sgfIndex?: number;
    /** 归档ID */
    archiveId?: string;
  };
}
