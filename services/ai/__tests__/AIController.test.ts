/**
 * AIController 测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIController } from '../AIController';
import type { IAIEngine, AnalyzeOptions } from '../../../infrastructure/ai';
import type { BoardState, PlayerColor } from '../../../domain';
import type { Difficulty } from '../types';

/**
 * 创建 Mock AI Engine
 */
function createMockEngine(): IAIEngine {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    analyze: vi.fn().mockResolvedValue(createMockAnalysisResult()),
    evaluate: vi.fn().mockResolvedValue({}),
    evaluateBatch: vi.fn().mockResolvedValue([]),
    getEngineInfo: vi.fn().mockReturnValue({ backend: 'test', modelName: 'test-model' }),
  };
}

/**
 * 创建 Mock 分析结果
 */
function createMockAnalysisResult(overrides?: { moves?: any[] }) {
  return {
    rootWinRate: 0.55,
    rootScoreLead: 3.5,
    moves: overrides?.moves ?? [
      {
        x: 3,
        y: 3,
        winRate: 0.56,
        scoreLead: 3.8,
        visits: 50,
        order: 1,
      },
      {
        x: 15,
        y: 15,
        winRate: 0.54,
        scoreLead: 3.2,
        visits: 30,
        order: 2,
      },
    ],
  };
}

/**
 * 创建空棋盘状态
 */
function createEmptyBoard(size = 19): BoardState {
  const board: BoardState = [];
  for (let y = 0; y < size; y++) {
    board[y] = [];
    for (let x = 0; x < size; x++) {
      board[y]![x] = null;
    }
  }
  return board;
}

describe('AIController', () => {
  let mockEngine: IAIEngine;
  let controller: AIController;

  beforeEach(() => {
    mockEngine = createMockEngine();
    controller = new AIController(mockEngine);
  });

  afterEach(() => {
    controller.destroy();
    vi.clearAllMocks();
  });

  describe('构造函数', () => {
    it('应接受可选的 engine 参数', () => {
      const ctrl = new AIController();
      expect(ctrl).toBeDefined();
      expect(ctrl.isInitialized()).toBe(false);
    });

    it('应接受可选的 difficulty 参数', () => {
      const ctrl = new AIController(mockEngine, 'hard');
      expect(ctrl.getDifficulty()).toBe('hard');
    });

    it('应默认 difficulty 为 medium', () => {
      const ctrl = new AIController(mockEngine);
      expect(ctrl.getDifficulty()).toBe('medium');
    });
  });

  describe('init()', () => {
    it('应初始化控制器并设置 modelId', async () => {
      await controller.init('test-model');

      expect(controller.isInitialized()).toBe(true);
      expect(controller.getModelId()).toBe('test-model');
    });

    it('应调用 engine.init 并传入正确的参数', async () => {
      await controller.init('test-model', '/custom/model.bin.gz');

      expect(mockEngine.init).toHaveBeenCalledWith({
        modelUrl: '/custom/model.bin.gz',
        onProgress: undefined,
      });
    });

    it('应生成默认的 modelUrl（如果未提供）', async () => {
      await controller.init('test-model');

      expect(mockEngine.init).toHaveBeenCalledWith({
        modelUrl: '/models/test-model.bin.gz',
        onProgress: undefined,
      });
    });

    it('应调用 onProgress 回调', async () => {
      const onProgress = vi.fn();
      (mockEngine.init as ReturnType<typeof vi.fn>).mockImplementation(async (args) => {
        args.onProgress?.(100, 200, 0.5);
      });

      await controller.init('test-model', undefined, onProgress);

      expect(onProgress).toHaveBeenCalledWith(100, 200, 0.5);
    });

    it('无 engine 时应抛出错误', async () => {
      const ctrl = new AIController();
      await expect(ctrl.init('test-model')).rejects.toThrow('AI engine not provided');
    });
  });

  describe('genmove()', () => {
    beforeEach(async () => {
      await controller.init('test-model');
    });

    it('应返回最佳着法', async () => {
      const board = createEmptyBoard();
      const result = await controller.genmove(board, null, 'black', [], 6.5);

      expect(result).toEqual({ x: 3, y: 3, winRate: 0.55, scoreLead: 3.5 });
    });

    it('应调用 client.analyze 并传入正确的参数', async () => {
      const board = createEmptyBoard();
      const previousBoard = createEmptyBoard();
      const moveHistory = [{ x: 3, y: 3, player: 'black' as PlayerColor }];

      await controller.genmove(board, previousBoard, 'white', moveHistory, 6.5);

      expect(mockEngine.analyze).toHaveBeenCalledWith(
        expect.objectContaining({
          board,
          previousBoard,
          currentPlayer: 'white',
          moveHistory: [{ x: 3, y: 3, player: 'black' }],
          komi: 6.5,
          visits: 100, // medium difficulty
        })
      );
    });

    it('应支持覆盖 visits', async () => {
      const board = createEmptyBoard();

      await controller.genmove(board, null, 'black', [], 6.5, 200);  // 直接传 visits

      expect(mockEngine.analyze).toHaveBeenCalledWith(
        expect.objectContaining({
          visits: 200,
        })
      );
    });

    it('取消后应返回 null', async () => {
      const board = createEmptyBoard();

      // 模拟异步分析
      let resolveAnalyze: (value: KataGoAnalysisPayload) => void;
      (mockEngine.analyze as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise<KataGoAnalysisPayload>((resolve) => {
            resolveAnalyze = resolve;
          })
      );

      const genmovePromise = controller.genmove(board, null, 'black', [], 6.5);
      controller.cancel();
      resolveAnalyze!(createMockAnalysisResult());

      const result = await genmovePromise;
      expect(result).toBeNull();
    });

    it('无可用着法时应返回 null', async () => {
      const board = createEmptyBoard();
      (mockEngine.analyze as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockAnalysisResult({ moves: [] })
      );

      const result = await controller.genmove(board, null, 'black', [], 6.5);
      expect(result).toBeNull();
    });

    it('未初始化时应抛出错误', async () => {
      const ctrl = new AIController(mockEngine);
      const board = createEmptyBoard();

      await expect(ctrl.genmove(board, null, 'black', [], 6.5)).rejects.toThrow('not initialized');
    });
  });

  describe('analyze()', () => {
    beforeEach(async () => {
      await controller.init('test-model');
    });

    it('应返回分析结果', async () => {
      const board = createEmptyBoard();
      const result = await controller.analyze(board, null, 'black', [], 6.5);

      expect(result).toEqual({
        winRate: 0.55,
        scoreLead: 3.5,
        topMoves: [
          {
            x: 3,
            y: 3,
            winRate: 0.56,
            scoreLead: 3.8,
            visits: 50,
          },
          {
            x: 15,
            y: 15,
            winRate: 0.54,
            scoreLead: 3.2,
            visits: 30,
          },
        ],
      });
    });

    it('应支持自定义 visits', async () => {
      const board = createEmptyBoard();

      await controller.analyze(board, null, 'black', [], 6.5, 500);

      expect(mockEngine.analyze).toHaveBeenCalledWith(
        expect.objectContaining({
          visits: 500,
        })
      );
    });

    it('应支持自定义 maxTimeMs', async () => {
      const board = createEmptyBoard();

      await controller.analyze(board, null, 'black', [], 6.5, 100, 5000);

      expect(mockEngine.analyze).toHaveBeenCalledWith(
        expect.objectContaining({
          visits: 100,
          maxTimeMs: 5000,
        })
      );
    });
  });

  describe('setDifficulty() / getDifficulty()', () => {
    it('应正确设置难度', () => {
      controller.setDifficulty('easy');
      expect(controller.getDifficulty()).toBe('easy');

      controller.setDifficulty('hard');
      expect(controller.getDifficulty()).toBe('hard');
    });

    it('不同难度应对应不同 visits', async () => {
      await controller.init('test-model');
      const board = createEmptyBoard();

      // easy -> 50 visits
      controller.setDifficulty('easy');
      await controller.genmove(board, null, 'black', [], 6.5);
      expect(mockEngine.analyze).toHaveBeenCalledWith(
        expect.objectContaining({ visits: 50 })
      );

      // hard -> 200 visits
      controller.setDifficulty('hard');
      await controller.genmove(board, null, 'black', [], 6.5);
      expect(mockEngine.analyze).toHaveBeenCalledWith(
        expect.objectContaining({ visits: 200 })
      );
    });
  });

  describe('isThinking() / cancel()', () => {
    beforeEach(async () => {
      await controller.init('test-model');
    });

    it('思考时应返回 true，完成后应返回 false', async () => {
      const board = createEmptyBoard();

      // 异步分析
      let resolveAnalyze: (value: KataGoAnalysisPayload) => void;
      (mockEngine.analyze as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise<KataGoAnalysisPayload>((resolve) => {
            resolveAnalyze = resolve;
          })
      );

      const genmovePromise = controller.genmove(board, null, 'black', [], 6.5);

      // 思考中
      expect(controller.isThinking()).toBe(true);

      // 完成分析
      resolveAnalyze!(createMockAnalysisResult());
      await genmovePromise;

      // 思考结束
      expect(controller.isThinking()).toBe(false);
    });

    it('无 engine 时 cancel() 不应抛出错误', async () => {
      await controller.destroy();
      expect(() => controller.cancel()).not.toThrow();
    });
  });

  describe('isInitialized()', () => {
    it('未初始化时应返回 false', () => {
      expect(controller.isInitialized()).toBe(false);
    });

    it('初始化后应返回 true', async () => {
      await controller.init('test-model');
      expect(controller.isInitialized()).toBe(true);
    });

    it('destroy() 后应返回 false', async () => {
      await controller.init('test-model');
      controller.destroy();
      expect(controller.isInitialized()).toBe(false);
    });
  });

  describe('destroy()', () => {
    it('应重置所有状态', async () => {
      await controller.init('test-model');
      controller.setDifficulty('hard');

      controller.destroy();

      expect(controller.isInitialized()).toBe(false);
      expect(controller.isThinking()).toBe(false);
      expect(controller.getModelId()).toBeNull();
      expect(controller.getDifficulty()).toBe('hard'); // difficulty 不重置
    });

    it('应可重复调用', () => {
      controller.destroy();
      controller.destroy();
      expect(controller.isInitialized()).toBe(false);
    });
  });

  describe('getModelId()', () => {
    it('未初始化时应返回 null', () => {
      expect(controller.getModelId()).toBeNull();
    });

    it('初始化后应返回 modelId', async () => {
      await controller.init('my-model');
      expect(controller.getModelId()).toBe('my-model');
    });
  });

  describe('countTerritory()', () => {
    beforeEach(async () => {
      await controller.init('test-model');
    });

    it('应返回 scoreLead（黑方视角）', async () => {
      const board = createEmptyBoard();
      const result = await controller.countTerritory(board, [], 6.5);

      expect(result).toBe(3.5);
    });

    it('应以黑方视角分析', async () => {
      const board = createEmptyBoard();

      await controller.countTerritory(board, [], 6.5);

      expect(mockEngine.analyze).toHaveBeenCalledWith(
        expect.objectContaining({
          currentPlayer: 'black',
          visits: 100,  // 数子使用 100 visits
        })
      );
    });
  });
});