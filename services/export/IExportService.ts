import type { ExportResult, ExportOptions } from '../../infrastructure/utils/export';

/**
 * 导出服务接口
 */
export interface IExportService {
  /** 导出 SGF 棋谱 */
  exportSGF(sgf: string, gameName: string, options?: ExportOptions): Promise<ExportResult>;

  /** 导出历史记录 */
  exportHistory(records: unknown[], filename?: string): Promise<ExportResult>;

  /** 导出 JSON 数据 */
  exportJSON(data: unknown, filename: string): Promise<ExportResult>;
}