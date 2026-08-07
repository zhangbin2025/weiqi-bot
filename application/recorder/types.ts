/**
 * 记谱应用层共享类型定义
 */
/** 棋谱历史查询选项 */
export interface RecorderHistoryOptions {
  keyword?: string;
  limit?: number;
  offset?: number;
}
/** 棋谱历史条目 */
export interface RecorderHistoryEntry {
  id: string;
  blackName: string;
  whiteName: string;
  moveCount: number;
  createdAt: number;
}
/** 棋谱统计 */
export interface RecorderStats {
  total: number;
  today: number;
}
/** 棋谱历史详情 */
export interface RecorderHistoryDetail {
  id: string;
  blackName: string;
  whiteName: string;
  moveCount: number;
  size: number;
  sgf: string;
  createdAt: number;
}
