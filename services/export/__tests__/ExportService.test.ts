/**
 * ExportService 测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExportService } from '../ExportService';
import type { IFileExporter, ExportResult } from '../../../infrastructure/utils/export';

/**
 * 模拟文件导出器
 */
class MockFileExporter implements IFileExporter {
  private exportedFiles: Map<string, string> = new Map();

  async exportText(content: string, filename: string): Promise<ExportResult> {
    this.exportedFiles.set(filename, content);
    return { success: true, path: filename };
  }

  async exportBlob(data: Blob | ArrayBuffer, filename: string): Promise<ExportResult> {
    return { success: true, path: filename };
  }

  async exportBase64(base64: string, filename: string): Promise<ExportResult> {
    return { success: true, path: filename };
  }

  async exportJSON(data: unknown, filename: string): Promise<ExportResult> {
    this.exportedFiles.set(filename, JSON.stringify(data));
    return { success: true, path: filename };
  }

  isAvailable(): boolean {
    return true;
  }

  getCapabilities() {
    return {
      text: true,
      binary: true,
      share: false,
      pickLocation: true,
      maxFileSize: -1,
    };
  }

  getExportedContent(filename: string): string | undefined {
    return this.exportedFiles.get(filename);
  }

  clear(): void {
    this.exportedFiles.clear();
  }
}

describe('ExportService', () => {
  let mockExporter: MockFileExporter;
  let service: ExportService;

  beforeEach(() => {
    mockExporter = new MockFileExporter();
    service = new ExportService(mockExporter);
  });

  describe('exportSGF', () => {
    it('应导出 SGF 棋谱', async () => {
      const sgf = '(;GM[1]SZ[19]';
      const result = await service.exportSGF(sgf, 'Test Game');

      expect(result.success).toBe(true);
      expect(result.path).toBe('Test Game.sgf');
    });

    it('应清理文件名中的非法字符', async () => {
      const sgf = '(;GM[1])';
      const result = await service.exportSGF(sgf, 'Game<>:"/\\|?*Name');

      expect(result.success).toBe(true);
      // 11个非法字符被替换为下划线
      expect(result.path).toBe('Game_________Name.sgf');
    });

    it('应限制文件名长度', async () => {
      const longName = 'A'.repeat(200);
      const result = await service.exportSGF('(;)', longName);

      expect(result.success).toBe(true);
      expect(result.path?.length).toBeLessThanOrEqual(104); // 100 + '.sgf'
    });

    it('应传递导出选项', async () => {
      const sgf = '(;GM[1])';
      const result = await service.exportSGF(sgf, 'Test', { silent: true });

      expect(result.success).toBe(true);
    });
  });

  describe('exportHistory', () => {
    it('应导出历史记录', async () => {
      const records = [
        { id: 1, action: 'move' },
        { id: 2, action: 'pass' },
      ];
      const result = await service.exportHistory(records);

      expect(result.success).toBe(true);
      expect(result.path).toMatch(/^history_\d{4}-\d{2}-\d{2}\.json$/);
    });

    it('应使用自定义文件名', async () => {
      const records = [{ id: 1 }];
      const result = await service.exportHistory(records, 'custom.json');

      expect(result.success).toBe(true);
      expect(result.path).toBe('custom.json');
    });

    it('应正确序列化历史数据', async () => {
      const records = [{ id: 1, data: 'test' }];
      await service.exportHistory(records, 'test.json');

      const content = mockExporter.getExportedContent('test.json');
      expect(content).toBeDefined();
      const parsed = JSON.parse(content!);
      expect(parsed).toEqual(records);
    });
  });

  describe('exportJSON', () => {
    it('应导出 JSON 数据', async () => {
      const data = { key: 'value', nested: { num: 123 } };
      const result = await service.exportJSON(data, 'data.json');

      expect(result.success).toBe(true);
      expect(result.path).toBe('data.json');
    });

    it('应支持数组数据', async () => {
      const data = [1, 2, 3, 4, 5];
      const result = await service.exportJSON(data, 'array.json');

      expect(result.success).toBe(true);
    });

    it('应支持嵌套对象', async () => {
      const data = {
        level1: {
          level2: {
            level3: 'deep value',
          },
        },
      };
      const result = await service.exportJSON(data, 'nested.json');

      expect(result.success).toBe(true);
    });

    it('应正确序列化复杂对象', async () => {
      const data = {
        name: 'test',
        count: 42,
        active: true,
        items: [1, 2, 3],
        meta: null,
      };
      await service.exportJSON(data, 'complex.json');

      const content = mockExporter.getExportedContent('complex.json');
      const parsed = JSON.parse(content!);
      expect(parsed).toEqual(data);
    });
  });
});