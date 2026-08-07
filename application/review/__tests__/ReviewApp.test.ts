import { describe, it, expect, vi } from 'vitest';
import { ReviewApp } from '../ReviewApp';
import type { IReviewService } from '../../../services/review/IReviewService';
import type { IModelManagementService } from '../../../services/model';
import type { IActivityLogService } from '../../../services/activity';

/** 创建 mock ReviewService */
function createMockReviewService(): IReviewService {
  return {
    loadFromSGF: vi.fn(),
    analyzeGame: vi.fn(),
    analyzeGameAsync: vi.fn(),
    analyzePosition: vi.fn(),
    analyzeMoves: vi.fn(),
    getBadMoves: vi.fn().mockReturnValue([]),
    getWinRateTrend: vi.fn().mockReturnValue([]),
    getState: vi.fn().mockReturnValue(null),
    getMoves: vi.fn().mockReturnValue(null),
    destroy: vi.fn(),
  } as unknown as IReviewService;
}

/** 创建 mock IModelManagementService */
function createMockModelManager(): IModelManagementService {
  return {
    getModels: vi.fn().mockResolvedValue([
      { id: 'katago-small', name: 'KataGo Small', size: '3.7MB' },
      { id: 'katago-large', name: 'KataGo Large', size: '18MB' },
    ]),
    switchModel: vi.fn().mockResolvedValue(undefined),
    getCurrentModel: vi.fn().mockReturnValue('katago-small'),
    getCurrentModelFileName: vi.fn().mockReturnValue('katago-small.bin'),
    savePreference: vi.fn().mockResolvedValue(undefined),
    loadPreference: vi.fn().mockResolvedValue('katago-small'),
    loadModelFileName: vi.fn().mockResolvedValue('katago-small.bin'),
    loadCustomModelUrl: vi.fn().mockResolvedValue(null),
  } as unknown as IModelManagementService;
}

/** 创建 mock ActivityLogService */
function createMockActivityLogService(): IActivityLogService {
  return {
    record: vi.fn().mockResolvedValue('act:1:abc'),
    query: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    stats: vi.fn().mockResolvedValue({ total: 0, today: 0, thisWeek: 0, thisMonth: 0, byType: {} }),
    count: vi.fn().mockResolvedValue(0),
    clear: vi.fn(),
  } as unknown as IActivityLogService;
}

describe('ReviewApp', () => {
  describe('模型管理', () => {
    it('应该获取当前模型', async () => {
      const modelManager = createMockModelManager();
      const app = new ReviewApp(undefined, modelManager, undefined);
      const modelId = app.getCurrentModel();
      expect(modelId).toBe('katago-small');
    });

    it('应该切换模型', async () => {
      const modelManager = createMockModelManager();
      const app = new ReviewApp(undefined, modelManager, undefined);
      await app.switchModel('katago-large');
      expect(modelManager.switchModel).toHaveBeenCalledWith('katago-large', undefined, undefined);
    });

    it('应该加载偏好', async () => {
      const modelManager = createMockModelManager();
      const app = new ReviewApp(undefined, modelManager, undefined);
      await app.loadPreference();
      expect(modelManager.loadPreference).toHaveBeenCalled();
    });

    it('无 ModelManager 时 getCurrentModel 应抛错', () => {
      const app = new ReviewApp();
      expect(() => app.getCurrentModel()).toThrow('ModelManagementService not provided');
    });
  });

  describe('构造函数', () => {
    it('应该接受可选参数', () => {
      const app = new ReviewApp();
      expect(app).toBeDefined();
    });

    it('应该接受全部参数', () => {
      const reviewService = createMockReviewService();
      const modelManager = createMockModelManager();
      const activityLogService = createMockActivityLogService();
      const app = new ReviewApp(reviewService, modelManager, activityLogService);
      expect(app).toBeDefined();
    });
  });
});
