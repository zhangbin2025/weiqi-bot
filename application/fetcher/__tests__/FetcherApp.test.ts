/**
 * FetcherApp 单元测试
 * @module application/fetcher/__tests__/FetcherApp.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FetcherApp } from '../FetcherApp';
import type { IGameService, GameServiceResult } from '../../../services/game';
import type { IExportService, ExportResult } from '../../../services/export';
import type { IActivityLogService } from '../../../services/activity';
describe('FetcherApp', () => {
  let gameService: IGameService;
  let exportService: IExportService;
  let activityLogService: IActivityLogService;
  let fetcherApp: FetcherApp;
  beforeEach(() => {
    gameService = {
      fetch: vi.fn(),
      getByArchiveId: vi.fn(),
    };
    exportService = {
      exportSGF: vi.fn(),
      exportHistory: vi.fn(),
      exportJSON: vi.fn(),
    };
    activityLogService = {
      record: vi.fn(),
      query: vi.fn(),
      clear: vi.fn(),
    };
    fetcherApp = new FetcherApp(gameService, exportService, activityLogService);
  });
  describe('downloadSGF', () => {
    it('成功下载棋谱', async () => {
      const mockSgf = '(;GM[1]FF[4]SZ[19])';
      vi.mocked(gameService.getByArchiveId).mockResolvedValue(mockSgf);
      vi.mocked(exportService.exportSGF).mockResolvedValue({ success: true, path: '/path/to/file.sgf' });
      const result = await fetcherApp.downloadSGF('archive-123', 'Black_vs_White');
      expect(gameService.getByArchiveId).toHaveBeenCalledWith('archive-123');
      expect(exportService.exportSGF).toHaveBeenCalledWith(mockSgf, 'Black_vs_White');
      expect(result.success).toBe(true);
      expect(result.path).toBe('/path/to/file.sgf');
    });
    it('棋谱不存在时返回失败', async () => {
      vi.mocked(gameService.getByArchiveId).mockResolvedValue(null);
      const result = await fetcherApp.downloadSGF('archive-404', 'Black_vs_White');
      expect(gameService.getByArchiveId).toHaveBeenCalledWith('archive-404');
      expect(exportService.exportSGF).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toBe('棋谱内容未找到');
    });
    it('导出失败时返回错误信息', async () => {
      const mockSgf = '(;GM[1]FF[4]SZ[19])';
      vi.mocked(gameService.getByArchiveId).mockResolvedValue(mockSgf);
      vi.mocked(exportService.exportSGF).mockResolvedValue({ success: false, error: '导出失败' });
      const result = await fetcherApp.downloadSGF('archive-123', 'Black_vs_White');
      expect(result.success).toBe(false);
      expect(result.error).toBe('导出失败');
    });
  });
});
