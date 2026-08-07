import type { IFileExporter, ExportResult, ExportOptions, ExportCapabilities } from './IFileExporter.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Terminal 端文件导出器
 * 直接写入文件系统
 */
export class TerminalFileExporter implements IFileExporter {
  private basePath: string;

  constructor(basePath: string = process.cwd()) {
    this.basePath = basePath;
  }

  async exportText(content: string, filename: string, options?: ExportOptions): Promise<ExportResult> {
    return this.writeFile(content, filename);
  }

  async exportBlob(data: Blob | ArrayBuffer, filename: string, options?: ExportOptions): Promise<ExportResult> {
    try {
      const buffer = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(await data.arrayBuffer());
      return this.writeBinary(buffer, filename);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '导出失败' };
    }
  }

  async exportBase64(base64: string, filename: string, mimeType?: string, options?: ExportOptions): Promise<ExportResult> {
    const buffer = Buffer.from(base64, 'base64');
    return this.writeBinary(buffer, filename);
  }

  async exportJSON(data: unknown, filename: string, options?: ExportOptions): Promise<ExportResult> {
    const content = JSON.stringify(data, null, 2);
    const name = filename.endsWith('.json') ? filename : `${filename}.json`;
    return this.writeFile(content, name);
  }

  isAvailable(): boolean {
    return typeof process !== 'undefined' && typeof fs !== 'undefined';
  }

  getCapabilities(): ExportCapabilities {
    return {
      text: true,
      binary: true,
      share: false,
      pickLocation: true,
      maxFileSize: -1,
    };
  }

  private async writeFile(content: string, filename: string): Promise<ExportResult> {
    try {
      const filePath = path.join(this.basePath, filename);
      await fs.promises.writeFile(filePath, content, 'utf-8');
      return { success: true, path: filePath };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '写入失败' };
    }
  }

  private async writeBinary(buffer: Buffer, filename: string): Promise<ExportResult> {
    try {
      const filePath = path.join(this.basePath, filename);
      await fs.promises.writeFile(filePath, buffer);
      return { success: true, path: filePath };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '写入失败' };
    }
  }
}