import type { IFileExporter, ExportResult, ExportOptions } from '../../infrastructure/utils/export';
import type { IExportService } from './IExportService';

/**
 * 导出服务实现
 */
export class ExportService implements IExportService {
  constructor(private readonly exporter: IFileExporter) {}

  async exportSGF(sgf: string, gameName: string, options?: ExportOptions): Promise<ExportResult> {
    const filename = this.sanitizeFilename(gameName) + '.sgf';
    return this.exporter.exportText(sgf, filename, {
      mimeType: 'application/x-go-sgf',
      ...options,
    });
  }

  async exportHistory(records: unknown[], filename?: string): Promise<ExportResult> {
    const name = filename || `history_${this.formatDate()}.json`;
    return this.exporter.exportJSON(records, name);
  }

  async exportJSON(data: unknown, filename: string): Promise<ExportResult> {
    return this.exporter.exportJSON(data, filename);
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
  }

  private formatDate(): string {
    return new Date().toISOString().split('T')[0]!;
  }
}